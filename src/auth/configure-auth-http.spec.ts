import type { INestApplication } from '@nestjs/common';
import express from 'express';
import request from 'supertest';
import { ApiConfigService } from '../config/api-config.service';
import { configureAuthHttp } from './configure-auth-http';

describe('auth HTTP origin protection', () => {
  const server = express();
  configureAuthHttp(
    {
      setGlobalPrefix: () => {},
      useGlobalPipes: () => {},
      enableCors: () => {},
      use: server.use.bind(server),
    } as unknown as INestApplication,
    { corsOrigins: ['http://localhost:3001'] } as ApiConfigService,
  );
  server.post('/api/auth/staff/login', (_req, res) => res.json({ reachedLogin: true }));

  it('allows Swagger on the exact API origin', async () => {
    await request(server)
      .post('/api/auth/staff/login')
      .set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:3000')
      .expect(200);
  });

  it('allows the configured frontend and clients without Origin', async () => {
    await request(server)
      .post('/api/auth/staff/login')
      .set('Origin', 'http://localhost:3001')
      .expect(200);
    await request(server).post('/api/auth/staff/login').expect(200);
  });

  it('rejects untrusted origins, protocol changes, and forwarded host spoofing', async () => {
    for (const origin of [
      'https://evil.example',
      'https://localhost:3000',
      'http://localhost.evil.example:3000',
    ]) {
      await request(server)
        .post('/api/auth/staff/login')
        .set('Host', 'localhost:3000')
        .set('Origin', origin)
        .set('X-Forwarded-Host', new URL(origin).host)
        .expect(403);
    }
  });
});
