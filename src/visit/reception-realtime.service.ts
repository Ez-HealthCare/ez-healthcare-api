import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { RequestHandler } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { API_PREFIX } from '../common/constants/app.constants';
import { Role } from '../user/enums/role.enum';

const PATH = '/' + API_PREFIX + '/reception/live';
const PROTOCOL = 'reception-live';
const GRANT_TTL_MS = 30_000;
const CONNECTION_TTL_MS = 15 * 60_000;
const UPDATE = JSON.stringify({ type: 'reception.queue.updated' });
const TRIAGE_UPDATE = JSON.stringify({ type: 'triage.queue.updated' });
const CLINIC_UPDATE = JSON.stringify({ type: 'clinic.queue.updated' });
const TRIAGE_MUTATION =
  /^\/visits\/[^/]+\/(verify|intake|assign-clinic|emergency-dispatch|station-arrival\/triage|triage\/start)$/;
const CLINIC_MUTATION =
  /^\/visits\/[^/]+\/(assign-clinic|station-arrival\/clinic|call|start-exam|report-return|requeue|transfer|orders|conclusion)$/;

const POST_MUTATION =
  /^\/visits\/(hall-ticket|reception\/(walk-in|call-next)|[^/]+\/(reissue|emergency-dispatch))$|^\/appointments\/[^/]+\/reception\/check-in$|^\/reception-requests\/reception\/[^/]+\/confirm$/;
const PUT_MUTATION =
  /^\/visits\/[^/]+\/(reception\/(call|pause|recall)|verify|reject-verification)$/;

@Injectable()
export class ReceptionRealtimeService implements OnModuleDestroy {
  private readonly grants = new Map<string, { expiry: number; role: Role }>();
  private readonly roles = new WeakMap<WebSocket, Role>();
  private readonly websocket = new WebSocketServer({
    noServer: true,
    maxPayload: 1024,
    handleProtocols: (protocols) => (protocols.has(PROTOCOL) ? PROTOCOL : false),
  });

  issueGrant(role: Role) {
    const now = Date.now();
    for (const [key, grant] of this.grants) {
      if (grant.expiry <= now) this.grants.delete(key);
    }
    if (this.grants.size >= 2048) {
      throw new ServiceUnavailableException('Too many pending realtime connections.');
    }
    const token = randomBytes(24).toString('base64url');
    this.grants.set(token, { expiry: now + GRANT_TTL_MS, role });
    return { token };
  }

  attach(server: Server, origins: string[]) {
    server.on('upgrade', (request, socket, head) => {
      if (request.url !== PATH) {
        socket.destroy();
        return;
      }
      const [protocol, token, extra] =
        request.headers['sec-websocket-protocol']?.split(',').map((part) => part.trim()) ?? [];
      const grant = token ? this.grants.get(token) : undefined;
      if (
        protocol !== PROTOCOL ||
        !token ||
        extra ||
        !grant ||
        grant.expiry <= Date.now() ||
        !origins.includes(request.headers.origin ?? '')
      ) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return;
      }

      this.grants.delete(token);
      this.websocket.handleUpgrade(request, socket, head, (client) => {
        this.roles.set(client, grant.role);
        const timeout = setTimeout(() => client.close(4000, 'Reconnect'), CONNECTION_TTL_MS);
        timeout.unref();
        client.on('error', () => client.terminate());
        client.once('close', () => clearTimeout(timeout));
      });
    });
  }

  // Nest sends a successful response after the controller's awaited transaction commits.
  readonly afterMutation: RequestHandler = (request, response, next) => {
    const path = request.path.replace(/\/$/, '');
    const prefix = '/' + API_PREFIX;
    const route = path.startsWith(prefix + '/') ? path.slice(prefix.length) : '';
    const mutation =
      (request.method === 'POST' && POST_MUTATION.test(route)) ||
      (request.method === 'PUT' && PUT_MUTATION.test(route));
    const changes = request.method === 'POST' || request.method === 'PUT';
    const triage = changes && TRIAGE_MUTATION.test(route);
    const clinic = changes && CLINIC_MUTATION.test(route);
    if (mutation || triage || clinic) {
      response.once('finish', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return;
        for (const client of this.websocket.clients) {
          if (client.readyState !== WebSocket.OPEN || client.bufferedAmount >= 1024) continue;
          const role = this.roles.get(client);
          if (role === Role.PATIENT) {
            client.send(mutation ? UPDATE : triage ? TRIAGE_UPDATE : CLINIC_UPDATE);
          } else if (triage && (role === Role.NURSE || role === Role.ADMIN)) {
            client.send(TRIAGE_UPDATE);
          } else if (clinic && role === Role.DOCTOR) {
            client.send(CLINIC_UPDATE);
          }
        }
      });
    }
    next();
  };

  onModuleDestroy() {
    for (const client of this.websocket.clients) client.terminate();
    this.websocket.close();
    this.grants.clear();
  }
}
