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
    private readonly audit: AuditService,
  ) {}

  async getMyCurrent(patientId: string) {
    return this.requests.findOne({
      where: { patientId, status: In(ACTIVE_REQUEST_STATUSES) },
      order: { updatedAt: 'DESC' },
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
        status: In([QueueTicketStatus.ACTIVE, QueueTicketStatus.PAUSED]),
      },
    });
    if (activeTicket) {
      throw new ConflictException('You already have an active reception ticket.');
    }
  }
}
