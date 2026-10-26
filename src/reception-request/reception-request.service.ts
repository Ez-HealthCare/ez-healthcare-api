import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { User } from '../database/entities/user.entity';
import { QueueTicket } from '../visit/entities/queue-ticket.entity';
import { Visit } from '../visit/entities/visit.entity';
import { QueueTicketStatus } from '../visit/enums/queue-ticket.enum';
import { QueueTicketOperation } from '../visit/enums/queue-ticket.enum';
import { QueueTicketService } from '../visit/queue-ticket.service';
import { ApiConfigService } from '../config/api-config.service';
import { VisitStatus } from '../visit/enums/visit-status.enum';
import { SaveReceptionRequestDraftDto } from './dto/save-reception-request-draft.dto';
import { ReceptionRequest } from './entities/reception-request.entity';
import { ReceptionRequestStatus } from './enums/reception-request-status.enum';

const ACTIVE_REQUEST_STATUSES = [
  ReceptionRequestStatus.DRAFT,
  ReceptionRequestStatus.RECEPTION_PENDING,
];

@Injectable()
export class ReceptionRequestService {
  constructor(
    @InjectRepository(ReceptionRequest)
    private readonly requests: Repository<ReceptionRequest>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Visit)
    private readonly visits: Repository<Visit>,
    @InjectRepository(QueueTicket)
    private readonly tickets: Repository<QueueTicket>,
    private readonly queue: QueueTicketService,
    private readonly config: ApiConfigService,
    private readonly audit: AuditService,
  ) {}

  async getMyCurrent(patientId: string) {
    return this.requests.findOne({
      where: { patientId, status: In(ACTIVE_REQUEST_STATUSES) },
      order: { updatedAt: 'DESC' },
    });
  }

  async listPending(search?: string) {
    const query = this.requests
      .createQueryBuilder('request')
      .innerJoinAndSelect('request.patient', 'patient')
      .where('request.status = :status', { status: ReceptionRequestStatus.RECEPTION_PENDING })
      .orderBy('request.submitted_at', 'ASC');
    if (search?.trim()) {
      query.andWhere(
        '(patient.name ILIKE :search OR patient.national_id ILIKE :search OR patient.phone ILIKE :search)',
        { search: `%${search.trim()}%` },
      );
    }
    return query.getMany();
  }

  async confirm(requestId: string, actor: { id: string; role: string }) {
    const business = this.queue.requireIssuanceWindow();
    return this.queue.transaction(async (manager) => {
      const request = await manager
        .getRepository(ReceptionRequest)
        .createQueryBuilder('request')
        .setLock('pessimistic_write')
        .where('request.id = :requestId', { requestId })
        .getOne();
      if (!request) throw new NotFoundException('Reception request not found.');
      if (request.status !== ReceptionRequestStatus.RECEPTION_PENDING) {
        throw new ConflictException('This reception request has already been processed.');
      }
      const issued = await this.queue.issueReceptionHallTicket(manager, {
        patientId: request.patientId,
        actor: actor as any,
        idempotencyKey: `reception-request:${request.id}`,
        operation: QueueTicketOperation.HALL_RECEPTION_REQUEST,
        requestFingerprint: this.queue.fingerprint({ requestId: request.id, actorId: actor.id }),
        businessDate: business.businessDate,
        expiresAt: business.expiresAt,
        chiefComplaint: request.chiefComplaint,
      });
      request.status = ReceptionRequestStatus.CONVERTED_TO_VISIT;
      request.visitId = issued.visit.id;
      request.processedAt = new Date();
      request.processedById = actor.id;
      await manager.getRepository(ReceptionRequest).save(request);
      await this.audit.log(
        { action: 'CONVERT_RECEPTION_REQUEST_TO_VISIT', actorId: actor.id, actorRole: actor.role, targetEntityType: 'ReceptionRequest', targetEntityId: request.id, metadata: { visitId: issued.visit.id, hallTicketNumber: issued.visit.hallTicketNumber } },
        manager,
      );
      return this.queue.ticketResponse(issued.visit, issued.ticket);
    });
  }

  async reject(requestId: string, reason: string, actor: { id: string; role: string }) {
    return this.queue.transaction(async (manager) => {
      const request = await manager
        .getRepository(ReceptionRequest)
        .createQueryBuilder('request')
        .setLock('pessimistic_write')
        .where('request.id = :requestId', { requestId })
        .getOne();
      if (!request) throw new NotFoundException('Reception request not found.');
      if (request.status !== ReceptionRequestStatus.RECEPTION_PENDING) {
        throw new ConflictException('Only a pending reception request can be rejected.');
      }
      request.status = ReceptionRequestStatus.REJECTED;
      request.rejectionReason = reason.trim();
      request.processedAt = new Date();
      request.processedById = actor.id;
      const saved = await manager.getRepository(ReceptionRequest).save(request);
      await this.audit.log(
        { action: 'REJECT_RECEPTION_REQUEST', actorId: actor.id, actorRole: actor.role, targetEntityType: 'ReceptionRequest', targetEntityId: saved.id, metadata: { reason: saved.rejectionReason } },
        manager,
      );
      return saved;
    });
  }

  async saveDraft(patientId: string, dto: SaveReceptionRequestDraftDto) {
    const current = await this.getMyCurrent(patientId);
    if (current?.status === ReceptionRequestStatus.RECEPTION_PENDING) {
      throw new ConflictException('A submitted reception request can no longer be edited.');
    }

    const draft =
      current ?? this.requests.create({ patientId, status: ReceptionRequestStatus.DRAFT });
    Object.assign(draft, dto);
    const saved = await this.requests.save(draft);
    await this.audit.log({
      action: 'SAVE_RECEPTION_REQUEST_DRAFT',
      actorId: patientId,
      actorRole: 'PATIENT',
      targetEntityType: 'ReceptionRequest',
      targetEntityId: saved.id,
      metadata: { fields: Object.keys(dto) },
    });
    return saved;
  }

  async submit(patientId: string) {
    const request = await this.requests.findOne({
      where: { patientId, status: ReceptionRequestStatus.DRAFT },
    });
    if (!request) throw new NotFoundException('No reception request draft was found.');

    await this.assertProfileComplete(patientId);
    this.assertReadyToSubmit(request);
    await this.assertNoActiveVisit(patientId);

    request.status = ReceptionRequestStatus.RECEPTION_PENDING;
    request.submittedAt = new Date();
    const saved = await this.requests.save(request);
    await this.audit.log({
      action: 'SUBMIT_RECEPTION_REQUEST',
      actorId: patientId,
      actorRole: 'PATIENT',
      targetEntityType: 'ReceptionRequest',
      targetEntityId: saved.id,
      metadata: { symptomCodes: saved.symptomCodes ?? [] },
    });
    return saved;
  }

  async cancelMyCurrent(patientId: string) {
    const request = await this.getMyCurrent(patientId);
    if (!request) throw new NotFoundException('No active reception request was found.');

    request.status = ReceptionRequestStatus.CANCELLED;
    const saved = await this.requests.save(request);
    await this.audit.log({
      action: 'CANCEL_RECEPTION_REQUEST',
      actorId: patientId,
      actorRole: 'PATIENT',
      targetEntityType: 'ReceptionRequest',
      targetEntityId: saved.id,
    });
    return saved;
  }

  private assertReadyToSubmit(request: ReceptionRequest) {
    if (
      !request.chiefComplaint?.trim() ||
      !request.symptomCodes?.length ||
      !request.symptomOnset?.trim() ||
      !request.symptomSeverity?.trim()
    ) {
      throw new BadRequestException(
        'chiefComplaint, symptomCodes, symptomOnset, and symptomSeverity are required before submission.',
      );
    }
  }

  private async assertProfileComplete(patientId: string) {
    const patient = await this.users.findOne({ where: { id: patientId } });
    if (
      !patient ||
      !patient.name?.trim() ||
      !patient.dateOfBirth ||
      !patient.gender?.trim() ||
      !patient.phone?.trim() ||
      !patient.nationalId?.trim() ||
      patient.allergies == null
    ) {
      throw new BadRequestException(
        'Complete your personal profile before submitting a reception request.',
      );
    }
  }

  private async assertNoActiveVisit(patientId: string) {
    const activeVisit = await this.visits.findOne({
      where: {
        patientId,
        status: In([
          VisitStatus.HALL_WAITING,
          VisitStatus.RECEPTION_VERIFIED,
          VisitStatus.TRIAGE_PENDING,
        ]),
      },
      order: { createdAt: 'DESC' },
    });
    if (!activeVisit) return;

    const activeTicket = await this.tickets.findOne({
      where: {
        visitId: activeVisit.id,
        status: In([QueueTicketStatus.ACTIVE, QueueTicketStatus.CALLED, QueueTicketStatus.PAUSED]),
      },
    });
    if (activeTicket) {
      throw new ConflictException('You already have an active reception ticket.');
    }
  }
}
