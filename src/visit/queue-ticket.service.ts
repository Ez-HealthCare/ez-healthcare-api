import { createHash } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { MAX_PATIENT_HALL_REISSUES } from '../common/constants/clinical.constants';
import { ApiConfigService } from '../config/api-config.service';
import { User } from '../database/entities/user.entity';
import { NotificationService } from '../notification/notification.service';
import { Role } from '../user/enums/role.enum';
import { getBusinessTime } from './business-time';
import { clinicalConflict } from './clinical-error';
import { CreateHallTicketDto } from './dto/create-hall-ticket.dto';
import { ReissueTicketDto } from './dto/queue-action.dto';
import { QueueTicket } from './entities/queue-ticket.entity';
import { Visit } from './entities/visit.entity';
import {
  QueueTicketKind,
  QueueTicketOperation,
  QueueTicketStatus,
} from './enums/queue-ticket.enum';
import { VisitStatus } from './enums/visit-status.enum';

type Actor = { id: string; role: Role };
type TicketIdentity = {
  actor: Actor;
  operation: QueueTicketOperation;
  fingerprint: string;
  visitId?: string;
};

@Injectable()
export class QueueTicketService {
  private readonly inFlight = new Map<
    string,
    { identity: TicketIdentity; promise: Promise<unknown> }
  >();

  constructor(
    @InjectRepository(QueueTicket)
    private readonly tickets: Repository<QueueTicket>,
    private readonly dataSource: DataSource,
    private readonly config: ApiConfigService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  requireIdempotencyKey(value?: string): string {
    const key = value?.trim();
    if (!key || key.length > 100) {
      throw new BadRequestException('A valid Idempotency-Key header is required.');
    }
    return key;
  }

  requireIssuanceWindow(now = new Date()) {
    const business = getBusinessTime(now, this.config.queueIssuanceWindows);
    if (!business.isIssuanceOpen) {
      throw clinicalConflict(
        'QUEUE_CLOSED',
        'Queue numbers are not issued outside configured clinic hours.',
      );
    }
    return business;
  }

  fingerprint(value: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  async expireDueTickets(now = new Date(), manager?: EntityManager): Promise<number> {
    const repo = manager?.getRepository(QueueTicket) ?? this.tickets;
    const result = await repo
      .createQueryBuilder()
      .update(QueueTicket)
      .set({ status: QueueTicketStatus.EXPIRED })
      .where('status IN (:...statuses)', {
        statuses: [QueueTicketStatus.ACTIVE, QueueTicketStatus.PAUSED],
      })
      .andWhere('expires_at <= :now', { now })
      .execute();
    return result.affected ?? 0;
  }

  async lockVisit(manager: EntityManager, id: string): Promise<Visit> {
    const visit = await manager
      .getRepository(Visit)
      .createQueryBuilder('visit')
      .setLock('pessimistic_write')
      .where('visit.id = :id', { id })
      .getOne();
    if (!visit) throw new NotFoundException(`Visit with ID ${id} not found`);
    return visit;
  }

  async activeTicket(
    visitId: string,
    kind: QueueTicketKind,
    manager?: EntityManager,
  ): Promise<QueueTicket | null> {
    await this.expireDueTickets(new Date(), manager);
    const repo = manager?.getRepository(QueueTicket) ?? this.tickets;
    return repo.findOne({
      where: {
        visitId,
        kind,
        status: In([QueueTicketStatus.ACTIVE, QueueTicketStatus.PAUSED]),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async latestReplaceableTicket(
    visitId: string,
    kind: QueueTicketKind,
    manager?: EntityManager,
  ): Promise<QueueTicket | null> {
    await this.expireDueTickets(new Date(), manager);
    const repo = manager?.getRepository(QueueTicket) ?? this.tickets;
    return repo.findOne({
      where: {
        visitId,
        kind,
        status: In([QueueTicketStatus.ACTIVE, QueueTicketStatus.PAUSED, QueueTicketStatus.EXPIRED]),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async nextSequence(
    manager: EntityManager,
    kind: QueueTicketKind,
    scopeKey: string,
    businessDate: string,
  ): Promise<number> {
    const rows = await manager.query(
      `INSERT INTO queue_counters (kind, scope_key, business_date, last_issued)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (kind, scope_key, business_date)
       DO UPDATE SET last_issued = queue_counters.last_issued + 1, updated_at = now()
       RETURNING last_issued`,
      [kind, scopeKey, businessDate],
    );
    return Number(rows[0].last_issued);
  }

  displayNumber(kind: QueueTicketKind, scopeKey: string, sequence: number) {
    return kind === QueueTicketKind.HALL
      ? `A-${String(sequence).padStart(3, '0')}`
      : `${scopeKey.replace('P.', 'CL-')}-${String(sequence).padStart(2, '0')}`;
  }

  ticketResponse(visit: Visit, ticket: QueueTicket) {
    return {
      visitId: visit.id,
      hallTicketNumber: visit.hallTicketNumber,
      clinicTicketNumber: visit.clinicTicketNumber,
      status: visit.status,
      ticket: {
        id: ticket.id,
        kind: ticket.kind,
        number: ticket.displayNumber,
        status: ticket.status,
        businessDate: ticket.businessDate,
        queuedAt: ticket.queuedAt,
        expiresAt: ticket.expiresAt,
      },
    };
  }

  private errorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const candidate = error as { code?: string; driverError?: { code?: string } };
    return candidate.code ?? candidate.driverError?.code;
  }

  private assertReplay(ticket: QueueTicket, identity: TicketIdentity): void {
    if (
      ticket.issuedById !== identity.actor.id ||
      ticket.operation !== identity.operation ||
      ticket.requestFingerprint !== identity.fingerprint ||
      (identity.visitId !== undefined && ticket.visitId !== identity.visitId)
    ) {
      throw clinicalConflict(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was already used for a different request.',
      );
    }
  }

  async replay(
    idempotencyKey: string,
    identity: TicketIdentity,
    manager?: EntityManager,
  ): Promise<ReturnType<QueueTicketService['ticketResponse']> | null> {
    const repo = manager?.getRepository(QueueTicket) ?? this.tickets;
    const ticket = await repo.findOne({ where: { idempotencyKey }, relations: { visit: true } });
    if (!ticket) return null;
    this.assertReplay(ticket, identity);
    return this.ticketResponse(ticket.visit, ticket);
  }

  async runIdempotent<T>(
    idempotencyKey: string,
    identity: TicketIdentity,
    action: (manager: EntityManager) => Promise<T>,
  ): Promise<T | ReturnType<QueueTicketService['ticketResponse']>> {
    const active = this.inFlight.get(idempotencyKey);
    if (active) {
      if (
        active.identity.actor.id !== identity.actor.id ||
        active.identity.operation !== identity.operation ||
        active.identity.visitId !== identity.visitId ||
        active.identity.fingerprint !== identity.fingerprint
      ) {
        throw clinicalConflict(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency key is already processing a different request.',
        );
      }
      return active.promise as Promise<T | ReturnType<QueueTicketService['ticketResponse']>>;
    }
    const promise = (async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await this.dataSource.transaction(async (manager) => {
            const replay = await this.replay(idempotencyKey, identity, manager);
            return replay ?? action(manager);
          });
        } catch (error) {
          lastError = error;
          const code = this.errorCode(error);
          if (code === '23505') {
            const replay = await this.replay(idempotencyKey, identity);
            if (replay) return replay;
          }
          if (!['23505', '40001', '40P01'].includes(code ?? '') || attempt === 2) throw error;
          await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        }
      }
      throw lastError;
    })();
    this.inFlight.set(idempotencyKey, { identity, promise });
    try {
      return await promise;
    } finally {
      if (this.inFlight.get(idempotencyKey)?.promise === promise) {
        this.inFlight.delete(idempotencyKey);
      }
    }
  }

  async transaction<T>(action: (manager: EntityManager) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', action);
      } catch (error) {
        lastError = error;
        if (!['40001', '40P01'].includes(this.errorCode(error) ?? '') || attempt === 2) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  async createHallTicket(_dto: CreateHallTicketDto, actor: Actor, idempotencyHeader?: string) {
    if (actor.role !== Role.PATIENT)
      throw new ForbiddenException('Only patients may request a hall ticket.');
    const idempotencyKey = this.requireIdempotencyKey(idempotencyHeader);
    const { businessDate, expiresAt } = this.requireIssuanceWindow();
    const identity: TicketIdentity = {
      actor,
      operation: QueueTicketOperation.HALL_ISSUE,
      fingerprint: this.fingerprint({
        actorId: actor.id,
        operation: QueueTicketOperation.HALL_ISSUE,
      }),
    };

    return this.runIdempotent(idempotencyKey, identity, async (manager) => {
      await this.expireDueTickets(new Date(), manager);
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [actor.id]);
      const replayAfterLock = await this.replay(idempotencyKey, identity, manager);
      if (replayAfterLock) return replayAfterLock;
      const patient = await manager.getRepository(User).findOne({ where: { id: actor.id } });
      if (!patient) throw new NotFoundException('Patient not found.');
      const existing = await manager
        .getRepository(QueueTicket)
        .createQueryBuilder('ticket')
        .innerJoin('ticket.visit', 'visit')
        .where('visit.patient_id = :patientId', { patientId: actor.id })
        .andWhere('ticket.business_date = :businessDate', { businessDate })
        .andWhere('ticket.status IN (:...statuses)', {
          statuses: [QueueTicketStatus.ACTIVE, QueueTicketStatus.PAUSED],
        })
        .getOne();
      if (existing) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'Patient already has an active visit today.',
        );
      }
      const sequence = await this.nextSequence(
        manager,
        QueueTicketKind.HALL,
        'FACILITY',
        businessDate,
      );
      const displayNumber = this.displayNumber(QueueTicketKind.HALL, 'FACILITY', sequence);
      const visitRepo = manager.getRepository(Visit);
      const visit = await visitRepo.save(
        visitRepo.create({
          patientId: actor.id,
          hallTicketNumber: displayNumber,
          status: VisitStatus.HALL_WAITING,
        }),
      );
      const ticketRepo = manager.getRepository(QueueTicket);
      const ticket = await ticketRepo.save(
        ticketRepo.create({
          visitId: visit.id,
          kind: QueueTicketKind.HALL,
          scopeKey: 'FACILITY',
          businessDate,
          sequence,
          displayNumber,
          status: QueueTicketStatus.ACTIVE,
          issuedById: actor.id,
          idempotencyKey,
          operation: identity.operation,
          requestFingerprint: identity.fingerprint,
          queuedAt: new Date(),
          expiresAt,
        }),
      );
      await this.notifications.create(
        {
          userId: actor.id,
          visitId: visit.id,
          type: 'HALL_TICKET_ISSUED',
          title: 'Đã cấp số tiếp nhận',
          message: `Số tiếp nhận của bạn là ${displayNumber}.`,
        },
        manager,
      );
      await this.audit.log(
        {
          action: 'CREATE_HALL_TICKET',
          actorId: actor.id,
          actorRole: actor.role,
          targetEntityType: 'Visit',
          targetEntityId: visit.id,
          metadata: { hallTicketNumber: displayNumber, businessDate },
        },
        manager,
      );
      return this.ticketResponse(visit, ticket);
    });
  }

  async reissueTicket(id: string, dto: ReissueTicketDto, actor: Actor, idempotencyHeader?: string) {
    const idempotencyKey = this.requireIdempotencyKey(idempotencyHeader);
    const { businessDate, expiresAt } = this.requireIssuanceWindow();
    const operation =
      dto.kind === QueueTicketKind.HALL
        ? QueueTicketOperation.HALL_REISSUE
        : QueueTicketOperation.CLINIC_REISSUE;
    const identity: TicketIdentity = {
      actor,
      operation,
      visitId: id,
      fingerprint: this.fingerprint({
        actorId: actor.id,
        operation,
        visitId: id,
        kind: dto.kind,
        reason: dto.reason?.trim() ?? '',
      }),
    };
    const replay = await this.replay(idempotencyKey, identity);
    if (replay) return replay;
    const expectedTicket =
      actor.role === Role.PATIENT
        ? await this.activeTicket(id, dto.kind)
        : await this.latestReplaceableTicket(id, dto.kind);
    if (!expectedTicket) {
      throw clinicalConflict('TICKET_EXPIRED', 'No current or expired ticket to replace.');
    }

    return this.runIdempotent(idempotencyKey, identity, async (manager) => {
      const visit = await this.lockVisit(manager, id);
      const patientSelfService = actor.role === Role.PATIENT;
      const oldTicket = patientSelfService
        ? await this.activeTicket(id, dto.kind, manager)
        : await this.latestReplaceableTicket(id, dto.kind, manager);
      if (!oldTicket)
        throw clinicalConflict('TICKET_EXPIRED', 'No current or expired ticket to replace.');
      if (oldTicket.id !== expectedTicket.id) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'Ticket was already replaced by another request.',
        );
      }
      if (patientSelfService) {
        if (
          visit.patientId !== actor.id ||
          dto.kind !== QueueTicketKind.HALL ||
          visit.status !== VisitStatus.HALL_WAITING ||
          visit.hallReissueCount >= MAX_PATIENT_HALL_REISSUES
        ) {
          throw new ForbiddenException('Patient hall-ticket reissue is not available.');
        }
      } else if (![Role.NURSE, Role.RECEPTIONIST].includes(actor.role) || !dto.reason?.trim()) {
        throw new BadRequestException('Clinical staff must provide a reissue reason.');
      }
      if (
        [
          VisitStatus.IN_EXAMINATION,
          VisitStatus.PARACLINICAL_PENDING,
          VisitStatus.COMPLETED,
          VisitStatus.CANCELLED,
          VisitStatus.EMERGENCY_DISPATCHED,
        ].includes(visit.status)
      ) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'Ticket cannot be reissued after examination starts.',
        );
      }
      if (patientSelfService && oldTicket.status === QueueTicketStatus.EXPIRED) {
        throw clinicalConflict(
          'TICKET_EXPIRED',
          'Expired tickets can only be reissued by reception staff.',
        );
      }
      const scopeKey = dto.kind === QueueTicketKind.HALL ? 'FACILITY' : oldTicket.scopeKey;
      const sequence = await this.nextSequence(manager, dto.kind, scopeKey, businessDate);
      const displayNumber = this.displayNumber(dto.kind, scopeKey, sequence);
      oldTicket.status = QueueTicketStatus.SUPERSEDED;
      await manager.getRepository(QueueTicket).save(oldTicket);
      const ticketRepo = manager.getRepository(QueueTicket);
      const ticket = await ticketRepo.save(
        ticketRepo.create({
          visitId: id,
          kind: dto.kind,
          scopeKey,
          businessDate,
          sequence,
          displayNumber,
          status: QueueTicketStatus.ACTIVE,
          issuedById: actor.id,
          reissueOfId: oldTicket.id,
          reissueReason: dto.reason,
          idempotencyKey,
          operation,
          requestFingerprint: identity.fingerprint,
          queuedAt: new Date(),
          expiresAt,
        }),
      );
      if (dto.kind === QueueTicketKind.HALL) {
        visit.hallTicketNumber = displayNumber;
        if (patientSelfService) visit.hallReissueCount += 1;
      } else {
        visit.clinicTicketNumber = displayNumber;
        visit.status = VisitStatus.CLINIC_WAITING;
      }
      await manager.getRepository(Visit).save(visit);
      await this.notifications.create(
        {
          userId: visit.patientId,
          visitId: visit.id,
          type: 'TICKET_REISSUED',
          title: 'Đã cấp lại số',
          message: `Số cũ ${oldTicket.displayNumber} không còn hiệu lực. Số mới: ${displayNumber}.`,
        },
        manager,
      );
      await this.audit.log(
        {
          action: 'REISSUE_TICKET',
          actorId: actor.id,
          actorRole: actor.role,
          targetEntityType: 'Visit',
          targetEntityId: visit.id,
          metadata: {
            oldNumber: oldTicket.displayNumber,
            newNumber: displayNumber,
            reason: dto.reason,
          },
        },
        manager,
      );
      return this.ticketResponse(visit, ticket);
    });
  }
}
