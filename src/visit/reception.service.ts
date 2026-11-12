import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, IsNull, Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import {
  ELDERLY_PRIORITY_AGE,
  MAX_PATIENT_HALL_REISSUES,
  VN_OFFSET_MS,
} from '../common/constants/clinical.constants';
import { ApiConfigService } from '../config/api-config.service';
import { User } from '../database/entities/user.entity';
import { Department } from '../department/entities/department.entity';
import { DoctorSchedule } from '../department/entities/doctor-schedule.entity';
import { RoomType } from '../department/enums/room-type.enum';
import { NotificationService } from '../notification/notification.service';
import { Role } from '../user/enums/role.enum';
import { getBusinessTime } from './business-time';
import { clinicalConflict } from './clinical-error';
import { AssignClinicDto } from './dto/assign-clinic.dto';
import { RecordIntakeDto } from './dto/record-intake.dto';
import { ReceptionRecordsQueryDto } from './dto/reception-records-query.dto';
import { RejectVerificationDto, VerifyVisitDto } from './dto/verify-visit.dto';
import { PauseHallTicketDto } from './dto/queue-action.dto';
import { QueueTicket } from './entities/queue-ticket.entity';
import { VisitVital } from './entities/visit-vital.entity';
import { Visit } from './entities/visit.entity';
import {
  QueueTicketKind,
  QueueTicketOperation,
  QueueTicketStatus,
} from './enums/queue-ticket.enum';
import { VisitStatus } from './enums/visit-status.enum';
import { calculateNews2 } from './news2-calculator';
import { QueueTicketService } from './queue-ticket.service';
import { estimateReceptionStart } from './reception-eta';
import { assertTransition } from './visit-state-machine';

type Actor = { id: string; role: Role };

@Injectable()
export class ReceptionService {
  constructor(
    @InjectRepository(QueueTicket)
    private readonly tickets: Repository<QueueTicket>,
    @InjectRepository(Visit)
    private readonly visits: Repository<Visit>,
    private readonly queue: QueueTicketService,
    private readonly config: ApiConfigService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  private queueVisit(visit: Visit, ticket?: QueueTicket) {
    return {
      visitId: visit.id,
      hallTicketNumber: visit.hallTicketNumber,
      clinicTicketNumber: visit.clinicTicketNumber,
      status: visit.status,
      returnReportedAt: visit.returnReportedAt,
      ticketKind: ticket?.kind,
      ticketStatus: ticket?.status,
      callAttempts: ticket?.callAttempts,
      lastCalledAt: ticket?.lastCalledAt,
      businessDate: ticket?.businessDate,
      expiresAt: ticket?.expiresAt,
      patient: {
        id: visit.patient.id,
        name: visit.patient.name,
        dateOfBirth: visit.patient.dateOfBirth,
        nationalId: visit.patient.nationalId,
        insuranceCardNumber: visit.patient.insuranceCardNumber,
        allergies: visit.patient.allergies,
      },
      chiefComplaint: visit.chiefComplaint,
      symptomOnset: visit.symptomOnset,
      symptomDuration: visit.symptomDuration,
      symptomSeverity: visit.symptomSeverity,
      intakeCompleted: !!visit.intakeCompletedAt,
      isPriority: visit.isPriority,
      priorityReason: visit.priorityReason,
      createdAt: visit.createdAt,
      room: visit.currentDepartment
        ? { code: visit.currentDepartment.code, name: visit.currentDepartment.name }
        : null,
      vital: visit.vital ?? null,
    };
  }

  async getMyCurrentVisit(patientId: string) {
    await this.queue.expireDueTickets();
    const { businessDate } = getBusinessTime(new Date(), this.config.queueIssuanceWindows);
    const ticket = await this.tickets
      .createQueryBuilder('ticket')
      .innerJoinAndSelect('ticket.visit', 'visit')
      .leftJoinAndSelect('visit.currentDepartment', 'department')
      .leftJoinAndSelect('visit.vital', 'vital')
      .where('visit.patient_id = :patientId', { patientId })
      .andWhere('ticket.business_date = :businessDate', { businessDate })
      .andWhere('ticket.status IN (:...statuses)', {
        statuses: [
          QueueTicketStatus.ACTIVE,
          QueueTicketStatus.CALLED,
          QueueTicketStatus.PAUSED,
          QueueTicketStatus.EXPIRED,
          QueueTicketStatus.COMPLETED,
        ],
      })
      .orderBy("CASE WHEN ticket.status IN ('ACTIVE', 'PAUSED') THEN 0 ELSE 1 END", 'ASC')
      .addOrderBy('ticket.created_at', 'DESC')
      .getOne();
    if (!ticket) return null;
    const visit = ticket.visit;
    const [receptionEta, stageEta] = await Promise.all([
      this.getReceptionEta(ticket),
      ticket.status === QueueTicketStatus.EXPIRED
        ? undefined
        : this.getStageEta(visit, ticket.businessDate),
    ]);
    return {
      visitId: visit.id,
      ...(receptionEta && { receptionEta }),
      ...(stageEta && { stageEta }),
      hallTicketNumber: visit.hallTicketNumber,
      clinicTicketNumber: visit.clinicTicketNumber,
      status: visit.status,
      returnReportedAt: visit.returnReportedAt,
      room: visit.currentDepartment
        ? { code: visit.currentDepartment.code, name: visit.currentDepartment.name }
        : null,
      canReportReturn:
        visit.status === VisitStatus.TEMPORARILY_ABSENT &&
        ticket.kind === QueueTicketKind.CLINIC &&
        ticket.status === QueueTicketStatus.PAUSED,
      canPatientReissue:
        ticket.status === QueueTicketStatus.ACTIVE &&
        ticket.kind === QueueTicketKind.HALL &&
        visit.status === VisitStatus.HALL_WAITING &&
        visit.hallReissueCount < MAX_PATIENT_HALL_REISSUES,
      ticketStatus: ticket.status,
      businessDate: ticket.businessDate,
      expiresAt: ticket.expiresAt,
      intakeCompleted: !!visit.intakeCompletedAt,
    };
  }

  async confirmStageArrival(id: string, patientId: string, station: string, ticketNumber?: string) {
    if (!this.config.downstreamEta) throw new NotFoundException();
    return this.queue.transaction(async (manager) => {
      const visit = await this.queue.lockVisit(manager, id);
      if (visit.patientId !== patientId) throw new NotFoundException();
      const expected =
        station === 'triage' ? VisitStatus.TRIAGE_PENDING : VisitStatus.CLINIC_WAITING;
      if (!['triage', 'clinic'].includes(station) || visit.status !== expected) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'The visit is no longer waiting at this station.',
        );
      }
      if (station === 'triage') {
        visit.triageArrivedAt ??= new Date();
      } else {
        const ticket = await this.queue.activeTicket(id, QueueTicketKind.CLINIC, manager);
        if (
          !ticket ||
          ticket.status !== QueueTicketStatus.ACTIVE ||
          ticket.displayNumber !== ticketNumber ||
          ticket.expiresAt <= new Date()
        ) {
          throw clinicalConflict('TICKET_EXPIRED', 'The clinic ticket is no longer active.');
        }
        visit.clinicArrivedAt ??= new Date();
      }
      await manager.getRepository(Visit).save(visit);
      return { arrived: true };
    });
  }

  async startTriage(id: string) {
    if (!this.config.downstreamEta) throw new NotFoundException();
    return this.queue.transaction(async (manager) => {
      const visit = await this.queue.lockVisit(manager, id);
      if (visit.status !== VisitStatus.TRIAGE_PENDING || visit.intakeCompletedAt) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'The visit is no longer waiting for triage.',
        );
      }
      visit.triageStartedAt ??= new Date();
      visit.triageArrivedAt ??= visit.triageStartedAt;
      await manager.getRepository(Visit).save(visit);
      return { started: true };
    });
  }

  private async getStageEta(visit: Visit, businessDate: string) {
    const settings = this.config.downstreamEta;
    if (!settings) return undefined;
    const triage = visit.status === VisitStatus.TRIAGE_PENDING && !visit.intakeCompletedAt;
    const clinic = visit.status === VisitStatus.CLINIC_WAITING && !!visit.currentDepartmentId;
    if (!triage && !clinic) return undefined;
    const station = triage ? 'triage' : 'clinic';
    const readyAt = triage ? visit.triageArrivedAt : visit.clinicArrivedAt;
    const now = new Date();
    const status =
      triage && visit.triageStartedAt ? 'in-service' : readyAt ? 'waiting' : 'travelling';
    const result = { station, status, estimatedStartAt: null as Date | null, calculatedAt: now };
    if (status !== 'waiting') return result;

    const localTime = new Date(now.getTime() + VN_OFFSET_MS).toISOString();
    const localClock = localTime.slice(11, 16);
    const windows = this.config.queueIssuanceWindows;
    const window = windows.find(({ start, end }) => localClock >= start && localClock < end);
    if (!window || localTime.slice(0, 10) !== businessDate) return result;
    const midnight = Date.parse(businessDate + 'T00:00:00Z') - VN_OFFSET_MS;
    const [hours, minutes] = window.end.split(':').map(Number);
    const closesAt = new Date(midnight + (hours * 60 + minutes) * 60_000);
    const dayEnd = midnight + 86_400_000;
    const today = (date?: Date | null) =>
      !!date && date.getTime() >= midnight && date.getTime() < dayEnd;
    let starts: (Date | undefined)[];
    let waiting: Visit[];
    let counters = settings.triageCounters;
    let duration = settings.triageMinutes;
    const arrivedAt = (row: Visit) => (triage ? row.triageArrivedAt : row.clinicArrivedAt);
    if (triage) {
      const rows = await this.visits.find({
        where: {
          status: VisitStatus.TRIAGE_PENDING,
          intakeCompletedAt: IsNull(),
          triageArrivedAt: Not(IsNull()),
        },
      });
      starts = rows.filter((row) => today(row.triageStartedAt)).map((row) => row.triageStartedAt!);
      waiting = rows.filter((row) => !row.triageStartedAt && today(row.triageArrivedAt));
    } else {
      const { shiftType } = getBusinessTime(now, windows);
      const schedule =
        shiftType &&
        (await this.visits.manager.getRepository(DoctorSchedule).findOne({
          where: {
            departmentId: visit.currentDepartmentId,
            shiftDate: new Date(businessDate),
            shiftType,
          },
          relations: { doctor: true, department: true },
        }));
      if (!schedule || !schedule.doctor?.isActive || !schedule.department?.isActive) return result;
      const roomTickets = await this.tickets.find({
        where: {
          businessDate,
          kind: QueueTicketKind.CLINIC,
          scopeKey: schedule.department.code,
          status: QueueTicketStatus.ACTIVE,
        },
        relations: { visit: true },
      });
      waiting = roomTickets
        .map((ticket) => ticket.visit)
        .filter((row) => row.status === VisitStatus.CLINIC_WAITING && today(row.clinicArrivedAt));
      const inExam = await this.visits.find({
        where: {
          currentDepartmentId: visit.currentDepartmentId,
          status: VisitStatus.IN_EXAMINATION,
        },
      });
      starts = [
        ...inExam
          .filter((row) => row.currentDoctorId === schedule.doctorId)
          .map((row) => row.clinicStartedAt ?? undefined),
        ...roomTickets
          .filter((ticket) => ticket.visit.status === VisitStatus.CLINIC_CALLED)
          .map((ticket) => ticket.lastCalledAt),
      ];
      counters = 1;
      duration = schedule.slotDurationMin;
    }

    waiting.sort(
      (a, b) =>
        Number(b.isPriority) - Number(a.isPriority) ||
        arrivedAt(a)!.getTime() - arrivedAt(b)!.getTime() ||
        a.id.localeCompare(b.id),
    );
    const ahead = waiting.findIndex((row) => row.id === visit.id);
    if (ahead >= 0 && duration > 0) {
      result.estimatedStartAt = estimateReceptionStart(
        now,
        closesAt,
        counters,
        duration,
        ahead,
        starts,
      );
    }
    return result;
  }

  private async getReceptionEta(ticket: QueueTicket) {
    const settings = this.config.receptionEta;
    if (
      !settings ||
      ticket.kind !== QueueTicketKind.HALL ||
      ticket.status !== QueueTicketStatus.ACTIVE ||
      ticket.visit.status !== VisitStatus.HALL_WAITING
    ) {
      return undefined;
    }

    const hall = await this.tickets
      .createQueryBuilder('ticket')
      .innerJoin('ticket.visit', 'visit')
      .where('ticket.kind = :kind', { kind: QueueTicketKind.HALL })
      .andWhere('ticket.business_date = :businessDate', { businessDate: ticket.businessDate })
      .andWhere('ticket.status IN (:...statuses)', {
        statuses: [QueueTicketStatus.ACTIVE, QueueTicketStatus.CALLED],
      })
      .andWhere('visit.status = :visitStatus', { visitStatus: VisitStatus.HALL_WAITING })
      .orderBy('visit."isPriority"', 'DESC')
      .addOrderBy('ticket.queued_at', 'ASC')
      .addOrderBy('ticket.sequence', 'ASC')
      .getMany();

    const waitingAhead = hall
      .filter((entry) => entry.status === QueueTicketStatus.ACTIVE)
      .findIndex((entry) => entry.id === ticket.id);
    if (waitingAhead < 0) return undefined;

    const now = new Date();
    const localTime = new Date(now.getTime() + VN_OFFSET_MS).toISOString();
    const localClock = localTime.slice(11, 16);
    const window = this.config.queueIssuanceWindows.find(
      ({ start, end }) => localClock >= start && localClock < end,
    );

    let estimatedStartAt: Date | null = null;
    if (window && localTime.slice(0, 10) === ticket.businessDate) {
      const [hours, minutes] = window.end.split(':').map(Number);
      const closesAt = new Date(
        Date.parse(ticket.businessDate + 'T00:00:00Z') -
          VN_OFFSET_MS +
          (hours * 60 + minutes) * 60_000,
      );
      estimatedStartAt = estimateReceptionStart(
        now,
        closesAt,
        settings.counterCount,
        settings.serviceMinutes,
        waitingAhead,
        hall
          .filter((entry) => entry.status === QueueTicketStatus.CALLED)
          .map((entry) => entry.lastCalledAt),
      );
    }

    return { estimatedStartAt, calculatedAt: now };
  }

  async getReceptionQueue() {
    await this.queue.expireDueTickets();
    const { businessDate } = getBusinessTime(new Date(), this.config.queueIssuanceWindows);
    const tickets = await this.tickets.find({
      where: {
        kind: QueueTicketKind.HALL,
        businessDate,
        status: In([QueueTicketStatus.ACTIVE, QueueTicketStatus.CALLED]),
      },
      relations: {
        visit: { patient: true, vital: true, currentDepartment: true },
      },
      order: { queuedAt: 'ASC' },
    });
    return tickets
      .filter((ticket) => ticket.visit.status === VisitStatus.HALL_WAITING)
      .sort(
        (a, b) =>
          Number(b.visit.isPriority) - Number(a.visit.isPriority) ||
          a.queuedAt.getTime() - b.queuedAt.getTime(),
      )
      .map((ticket) => this.queueVisit(ticket.visit, ticket));
  }

  async getReceptionRecords(input: ReceptionRecordsQueryDto) {
    await this.queue.expireDueTickets();
    const businessDate =
      input.businessDate ||
      getBusinessTime(new Date(), this.config.queueIssuanceWindows).businessDate;
    const query = this.visits
      .createQueryBuilder('visit')
      .innerJoinAndSelect('visit.patient', 'patient')
      .leftJoinAndSelect('visit.currentDepartment', 'department')
      .where(
        'EXISTS (SELECT 1 FROM queue_tickets day_ticket WHERE day_ticket.visit_id = visit.id AND day_ticket.business_date = :businessDate)',
        { businessDate },
      );
    if (input.status) query.andWhere('visit.status = :status', { status: input.status });
    if (input.search?.trim()) {
      // Search both current and superseded numbers so a reissued ticket remains traceable.
      query.andWhere(
        "(patient.name ILIKE :search ESCAPE '!' OR patient.nationalId ILIKE :search ESCAPE '!' OR patient.insuranceCardNumber ILIKE :search ESCAPE '!' OR CAST(patient.id AS text) ILIKE :search ESCAPE '!' OR CAST(visit.id AS text) ILIKE :search ESCAPE '!' OR EXISTS (SELECT 1 FROM queue_tickets search_ticket WHERE search_ticket.visit_id = visit.id AND search_ticket.display_number ILIKE :search ESCAPE '!'))",
        {
          search: '%' + input.search.trim().replace(/[!%_]/g, (character) => '!' + character) + '%',
        },
      );
    }
    const [visits, total] = await query
      .orderBy('visit.created_at', 'DESC')
      .addOrderBy('visit.id', 'DESC')
      .skip((input.page - 1) * input.pageSize)
      .take(input.pageSize)
      .getManyAndCount();
    const tickets = visits.length
      ? await this.tickets.find({
          where: { visitId: In(visits.map((visit) => visit.id)) },
          order: { createdAt: 'DESC', id: 'DESC' },
        })
      : [];
    const byVisit = new Map<string, QueueTicket[]>();
    for (const ticket of tickets) {
      const history = byVisit.get(ticket.visitId) || [];
      history.push(ticket);
      byVisit.set(ticket.visitId, history);
    }
    return {
      businessDate,
      total,
      page: input.page,
      pageSize: input.pageSize,
      items: visits.map((visit) => {
        const history = byVisit.get(visit.id) || [];
        return {
          ...this.queueVisit(visit, history[0]),
          updatedAt: visit.updatedAt,
          isVerified: visit.isVerified,
          ticketHistory: history.map((ticket) => ({
            id: ticket.id,
            kind: ticket.kind,
            number: ticket.displayNumber,
            status: ticket.status,
            businessDate: ticket.businessDate,
            createdAt: ticket.createdAt,
            queuedAt: ticket.queuedAt,
            lastCalledAt: ticket.lastCalledAt,
            callAttempts: ticket.callAttempts,
            reissueReason: ticket.reissueReason,
          })),
        };
      }),
    };
  }

  async getTriageQueue() {
    const visits = await this.visits.find({
      where: { status: VisitStatus.TRIAGE_PENDING },
      relations: { patient: true, vital: true, currentDepartment: true },
      order: { isPriority: 'DESC', createdAt: 'ASC' },
    });
    return visits.map((visit) => ({
      ...this.queueVisit(visit),
      triageArrival:
        this.config.downstreamEta && !visit.intakeCompletedAt
          ? visit.triageStartedAt
            ? 'in-service'
            : visit.triageArrivedAt
              ? 'waiting'
              : 'travelling'
          : undefined,
      canStartTriage:
        !!this.config.downstreamEta && !visit.triageStartedAt && !visit.intakeCompletedAt,
    }));
  }

  async getExpiredReceptionQueue(businessDate?: string) {
    await this.queue.expireDueTickets();
    if (businessDate && !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
      throw new BadRequestException('businessDate must use YYYY-MM-DD.');
    }
    const tickets = await this.tickets.find({
      where: { ...(businessDate ? { businessDate } : {}), status: QueueTicketStatus.EXPIRED },
      relations: { visit: { patient: true, vital: true, currentDepartment: true } },
      order: { queuedAt: 'DESC' },
      take: 200,
    });
    const latest = new Map<string, QueueTicket>();
    for (const ticket of tickets) latest.set(ticket.visitId, ticket);
    return [...latest.values()].map((ticket) => this.queueVisit(ticket.visit, ticket));
  }

  async callHallTicket(id: string, actor: Actor) {
    return this.queue.transaction(async (manager) => {
      const visit = await this.queue.lockVisit(manager, id);
      if (visit.status !== VisitStatus.HALL_WAITING) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'Only a patient waiting at reception can be called.',
        );
      }
      const ticket = await this.queue.activeTicket(id, QueueTicketKind.HALL, manager);
      if (!ticket || ticket.status !== QueueTicketStatus.ACTIVE) {
        throw clinicalConflict('TICKET_EXPIRED', 'Visit has no active hall ticket.');
      }
      ticket.callAttempts += 1;
      ticket.lastCalledAt = new Date();
      ticket.status = QueueTicketStatus.CALLED;
      await manager.getRepository(QueueTicket).save(ticket);
      await this.notifications.create(
        {
          userId: visit.patientId,
          visitId: visit.id,
          type: 'HALL_TICKET_CALLED',
          title: 'Mời đến quầy tiếp nhận',
          message: `Mời số ${visit.hallTicketNumber} đến quầy tiếp nhận.`,
        },
        manager,
      );
      await this.audit.log(
        {
          action: 'CALL_HALL_TICKET',
          actorId: actor.id,
          actorRole: actor.role,
          targetEntityType: 'Visit',
          targetEntityId: id,
          metadata: { hallTicketNumber: visit.hallTicketNumber, callAttempts: ticket.callAttempts },
        },
        manager,
      );
      return {
        visitId: id,
        status: visit.status,
        ticketStatus: ticket.status,
        callAttempts: ticket.callAttempts,
        lastCalledAt: ticket.lastCalledAt,
      };
    });
  }

  async callNextHallTicket(actor: Actor) {
    await this.queue.expireDueTickets();
    const { businessDate } = getBusinessTime(new Date(), this.config.queueIssuanceWindows);
    const next = await this.tickets
      .createQueryBuilder('ticket')
      .innerJoinAndSelect('ticket.visit', 'visit')
      .where('ticket.kind = :kind', { kind: QueueTicketKind.HALL })
      .andWhere('ticket.business_date = :businessDate', { businessDate })
      .andWhere('ticket.status = :ticketStatus', { ticketStatus: QueueTicketStatus.ACTIVE })
      .andWhere('visit.status = :visitStatus', { visitStatus: VisitStatus.HALL_WAITING })
      .orderBy('visit."isPriority"', 'DESC')
      .addOrderBy('ticket.queued_at', 'ASC')
      .addOrderBy('ticket.sequence', 'ASC')
      .getOne();
    if (!next) throw new NotFoundException('No patient is waiting at reception.');
    return this.callHallTicket(next.visitId, actor);
  }

  async pauseHallTicket(id: string, dto: PauseHallTicketDto, actor: Actor) {
    return this.queue.transaction(async (manager) => {
      const visit = await this.queue.lockVisit(manager, id);
      if (visit.status !== VisitStatus.HALL_WAITING) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'Only a patient waiting at reception can be temporarily skipped.',
        );
      }
      const ticket = await this.queue.activeTicket(id, QueueTicketKind.HALL, manager);
      if (!ticket || ticket.status !== QueueTicketStatus.ACTIVE) {
        throw clinicalConflict('TICKET_EXPIRED', 'Visit has no active hall ticket.');
      }
      ticket.status = QueueTicketStatus.PAUSED;
      ticket.reissueReason = dto.reason.trim();
      await manager.getRepository(QueueTicket).save(ticket);
      await this.audit.log(
        {
          action: 'PAUSE_HALL_TICKET',
          actorId: actor.id,
          actorRole: actor.role,
          targetEntityType: 'Visit',
          targetEntityId: id,
          metadata: { hallTicketNumber: visit.hallTicketNumber, reason: dto.reason.trim() },
        },
        manager,
      );
      return { visitId: id, status: visit.status, ticketStatus: ticket.status };
    });
  }

  async recallHallTicket(id: string, actor: Actor) {
    return this.queue.transaction(async (manager) => {
      const visit = await this.queue.lockVisit(manager, id);
      if (visit.status !== VisitStatus.HALL_WAITING) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'Only a patient waiting at reception can be recalled.',
        );
      }
      const ticket = await this.queue.activeTicket(id, QueueTicketKind.HALL, manager);
      if (!ticket) throw clinicalConflict('TICKET_EXPIRED', 'Hall ticket not found.');
      ticket.status = QueueTicketStatus.ACTIVE;
      ticket.callAttempts += 1;
      ticket.lastCalledAt = new Date();
      await manager.getRepository(QueueTicket).save(ticket);
      await this.notifications.create(
        {
          userId: visit.patientId,
          visitId: visit.id,
          type: 'HALL_TICKET_CALLED',
          title: 'Mời đến quầy tiếp nhận',
          message: `Mời lại số ${visit.hallTicketNumber} đến quầy tiếp nhận.`,
        },
        manager,
      );
      await this.audit.log(
        {
          action: 'RECALL_HALL_TICKET',
          actorId: actor.id,
          actorRole: actor.role,
          targetEntityType: 'Visit',
          targetEntityId: id,
          metadata: { hallTicketNumber: visit.hallTicketNumber, callAttempts: ticket.callAttempts },
        },
        manager,
      );
      return {
        visitId: id,
        status: visit.status,
        ticketStatus: ticket.status,
        callAttempts: ticket.callAttempts,
        lastCalledAt: ticket.lastCalledAt,
      };
    });
  }

  async verifyVisit(id: string, dto: VerifyVisitDto, actor: Actor) {
    return this.queue.transaction(async (manager) => {
      const visit = await this.queue.lockVisit(manager, id);
      const hallTicket = await this.queue.activeTicket(id, QueueTicketKind.HALL, manager);
      if (!hallTicket || hallTicket.status !== QueueTicketStatus.CALLED) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'Only the patient currently called to the reception desk can be verified.',
        );
      }
      const patient = await manager.getRepository(User).findOne({ where: { id: visit.patientId } });
      if (!patient) throw new NotFoundException('Patient not found.');
      const targetStatus = dto.nationalIdVerified
        ? VisitStatus.RECEPTION_VERIFIED
        : VisitStatus.CANCELLED;
      assertTransition(visit.status, targetStatus);
      visit.status = targetStatus;
      visit.receptionistId = actor.id;
      visit.isVerified = dto.nationalIdVerified;
      if (dto.insuranceCardNumber) patient.insuranceCardNumber = dto.insuranceCardNumber;
      await manager.getRepository(User).save(patient);
      if (dto.nationalIdVerified) {
        assertTransition(visit.status, VisitStatus.TRIAGE_PENDING);
        visit.status = VisitStatus.TRIAGE_PENDING;
        await manager
          .getRepository(QueueTicket)
          .createQueryBuilder()
          .update(QueueTicket)
          .set({ status: QueueTicketStatus.COMPLETED })
          .where('visit_id = :id', { id })
          .andWhere('kind = :kind', { kind: QueueTicketKind.HALL })
          .andWhere('status IN (:...statuses)', {
            statuses: [QueueTicketStatus.ACTIVE, QueueTicketStatus.CALLED],
          })
          .execute();
      }
      await manager.getRepository(Visit).save(visit);
      if (!dto.nationalIdVerified) {
        await manager
          .getRepository(QueueTicket)
          .createQueryBuilder()
          .update(QueueTicket)
          .set({ status: QueueTicketStatus.SUPERSEDED })
          .where('visit_id = :id', { id })
          .andWhere('status IN (:...statuses)', {
            statuses: [
              QueueTicketStatus.ACTIVE,
              QueueTicketStatus.CALLED,
              QueueTicketStatus.PAUSED,
            ],
          })
          .execute();
      }
      await this.audit.log(
        {
          action: 'VERIFY_VISIT',
          actorId: actor.id,
          actorRole: actor.role,
          targetEntityType: 'Visit',
          targetEntityId: id,
          metadata: { status: visit.status, verified: dto.nationalIdVerified },
        },
        manager,
      );
      return dto.nationalIdVerified
        ? {
            visitId: visit.id,
            hallTicketNumber: visit.hallTicketNumber,
            status: visit.status,
            isVerified: visit.isVerified,
          }
        : { status: visit.status, message: 'Identity verification failed. Visit cancelled.' };
    });
  }

  async rejectVerification(id: string, dto: RejectVerificationDto, actor: Actor) {
    return this.queue.transaction(async (manager) => {
      const visit = await this.queue.lockVisit(manager, id);
      const hallTicket = await this.queue.activeTicket(id, QueueTicketKind.HALL, manager);
      if (!hallTicket || hallTicket.status !== QueueTicketStatus.CALLED) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'Only the patient currently called to the reception desk can be rejected.',
        );
      }
      assertTransition(visit.status, VisitStatus.CANCELLED);
      visit.status = VisitStatus.CANCELLED;
      visit.receptionistId = actor.id;
      await manager.getRepository(Visit).save(visit);
      await manager
        .getRepository(QueueTicket)
        .createQueryBuilder()
        .update(QueueTicket)
        .set({ status: QueueTicketStatus.SUPERSEDED })
        .where('visit_id = :id', { id })
        .andWhere('status IN (:...statuses)', {
          statuses: [QueueTicketStatus.ACTIVE, QueueTicketStatus.CALLED, QueueTicketStatus.PAUSED],
        })
        .execute();
      await this.audit.log(
        {
          action: 'REJECT_VERIFICATION',
          actorId: actor.id,
          actorRole: actor.role,
          targetEntityType: 'Visit',
          targetEntityId: id,
          metadata: { status: visit.status, reason: dto.reason },
        },
        manager,
      );
      return {
        visitId: id,
        status: visit.status,
        reason: dto.reason,
        message: 'Visit verification rejected by reception.',
      };
    });
  }

  async assignClinic(id: string, dto: AssignClinicDto, actor: Actor, idempotencyHeader?: string) {
    const idempotencyKey = this.queue.requireIdempotencyKey(idempotencyHeader);
    const { businessDate, expiresAt } = this.queue.requireIssuanceWindow();
    const operation = QueueTicketOperation.CLINIC_ASSIGN;
    const fingerprint = this.queue.fingerprint({
      actorId: actor.id,
      operation,
      visitId: id,
      departmentCode: dto.departmentCode,
      isPriority: !!dto.isPriority,
      priorityReason: dto.priorityReason ?? '',
    });
    return this.queue.runIdempotent(
      idempotencyKey,
      { actor, operation, fingerprint, visitId: id },
      async (manager) => {
        const visit = await this.queue.lockVisit(manager, id);
        const patient = await manager
          .getRepository(User)
          .findOne({ where: { id: visit.patientId } });
        if (!patient) throw new NotFoundException('Patient not found.');
        if (visit.status !== VisitStatus.TRIAGE_PENDING || !visit.intakeCompletedAt) {
          throw clinicalConflict(
            'VISIT_STATE_CONFLICT',
            'Complete identity verification and intake before assignment.',
          );
        }
        const department = await manager
          .getRepository(Department)
          .findOne({ where: { code: dto.departmentCode } });
        if (!department || !department.isActive || department.roomType !== RoomType.CONSULTATION) {
          throw new NotFoundException(`Department with code ${dto.departmentCode} not found`);
        }
        const [{ count }] = await manager.query(
          `SELECT COUNT(DISTINCT visit_id)::int AS count
             FROM queue_tickets
            WHERE kind = $1 AND scope_key = $2 AND business_date = $3
              AND status IN ($4, $5, $6)`,
          [
            QueueTicketKind.CLINIC,
            department.code,
            businessDate,
            QueueTicketStatus.ACTIVE,
            QueueTicketStatus.PAUSED,
            QueueTicketStatus.COMPLETED,
          ],
        );
        if (Number(count) >= department.maxQuotaPerSlot) {
          throw clinicalConflict(
            'ROOM_QUOTA_REACHED',
            `Clinic ${dto.departmentCode} has reached its daily quota.`,
          );
        }
        let isPriority = !!dto.isPriority;
        let priorityReason = dto.priorityReason;
        if (patient.dateOfBirth) {
          const age = Math.abs(
            new Date(Date.now() - new Date(patient.dateOfBirth).getTime()).getUTCFullYear() - 1970,
          );
          if (age >= ELDERLY_PRIORITY_AGE) {
            isPriority = true;
            priorityReason ||= 'Elderly patient over 80 years old';
          }
        }
        const sequence = await this.queue.nextSequence(
          manager,
          QueueTicketKind.CLINIC,
          department.code,
          businessDate,
        );
        const displayNumber = this.queue.displayNumber(
          QueueTicketKind.CLINIC,
          department.code,
          sequence,
        );
        Object.assign(visit, {
          initialDepartmentId: department.id,
          currentDepartmentId: department.id,
          clinicTicketNumber: displayNumber,
          status: VisitStatus.CLINIC_WAITING,
          isPriority,
          priorityReason,
          receptionistId: actor.id,
        });
        await manager.getRepository(Visit).save(visit);
        const ticketRepo = manager.getRepository(QueueTicket);
        const ticket = await ticketRepo.save(
          ticketRepo.create({
            visitId: id,
            kind: QueueTicketKind.CLINIC,
            scopeKey: department.code,
            businessDate,
            sequence,
            displayNumber,
            status: QueueTicketStatus.ACTIVE,
            issuedById: actor.id,
            idempotencyKey,
            operation,
            requestFingerprint: fingerprint,
            queuedAt: new Date(),
            expiresAt,
          }),
        );
        await ticketRepo.update(
          { visitId: id, kind: QueueTicketKind.HALL, status: QueueTicketStatus.ACTIVE },
          { status: QueueTicketStatus.COMPLETED },
        );
        await this.notifyAssignment(visit, department, manager);
        await this.audit.log(
          {
            action: 'ASSIGN_CLINIC',
            actorId: actor.id,
            actorRole: actor.role,
            targetEntityType: 'Visit',
            targetEntityId: id,
            metadata: {
              status: visit.status,
              clinicTicketNumber: displayNumber,
              departmentCode: department.code,
              isPriority,
            },
          },
          manager,
        );
        return {
          ...this.queue.ticketResponse(visit, ticket),
          departmentCode: department.code,
          departmentName: department.name,
          isPriority,
          priorityReason,
        };
      },
    );
  }

  async recordIntake(id: string, dto: RecordIntakeDto, actor: Actor) {
    return this.queue.transaction(async (manager) => {
      const visit = await this.queue.lockVisit(manager, id);
      if (
        ![
          VisitStatus.RECEPTION_VERIFIED,
          VisitStatus.TRIAGE_PENDING,
          VisitStatus.CLINIC_WAITING,
          VisitStatus.CLINIC_CALLED,
          VisitStatus.TEMPORARILY_ABSENT,
        ].includes(visit.status)
      ) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'Intake is locked after examination starts.',
        );
      }
      const patient = await manager.getRepository(User).findOne({ where: { id: visit.patientId } });
      if (!patient) throw new NotFoundException('Patient not found.');
      const news2 = calculateNews2(dto);
      const isRedFlag =
        dto.spo2 < 90 || dto.bloodPressureSystolic < 90 || news2.score >= 7 || !!dto.isRedFlag;
      const vitalRepo = manager.getRepository(VisitVital);
      let vital = await vitalRepo.findOne({ where: { visitId: id } });
      vital ??= vitalRepo.create({ visitId: id, nurseId: actor.id });
      Object.assign(vital, {
        nurseId: actor.id,
        bloodPressureSystolic: dto.bloodPressureSystolic,
        bloodPressureDiastolic: dto.bloodPressureDiastolic,
        heartRate: dto.heartRate,
        temperature: dto.temperature,
        spo2: dto.spo2,
        respiratoryRate: dto.respiratoryRate,
        weightKg: dto.weightKg,
        heightCm: dto.heightCm,
        news2Score: news2.score,
        news2Risk: news2.risk,
        notes: dto.notes,
        isRedFlag,
        redFlagReason: isRedFlag
          ? dto.redFlagReason || `Clinical red flag (NEWS2 ${news2.score})`
          : undefined,
      });
      Object.assign(visit, {
        chiefComplaint: dto.chiefComplaint.trim(),
        symptomOnset: dto.symptomOnset,
        symptomDuration: dto.symptomDuration,
        symptomSeverity: dto.symptomSeverity,
        intakeCompletedAt: new Date(),
        receptionistId: actor.id,
      });
      visit.isPriority ||= !!dto.isPriority;
      visit.priorityReason ||= dto.priorityReason;
      if (dto.allergies) patient.allergies = dto.allergies;
      if (isRedFlag) {
        const emergency = await manager
          .getRepository(Department)
          .findOne({ where: { code: 'P.001' } });
        visit.status = VisitStatus.EMERGENCY_DISPATCHED;
        visit.currentDepartmentId = emergency?.id;
        visit.isPriority = true;
        visit.priorityReason = vital.redFlagReason;
      } else if (visit.status === VisitStatus.RECEPTION_VERIFIED) {
        visit.status = VisitStatus.TRIAGE_PENDING;
      }
      await manager.getRepository(User).save(patient);
      await vitalRepo.save(vital);
      await manager.getRepository(Visit).save(visit);
      await this.audit.log(
        {
          action: 'RECORD_INTAKE',
          actorId: actor.id,
          actorRole: actor.role,
          targetEntityType: 'Visit',
          targetEntityId: id,
          metadata: { status: visit.status, news2Score: news2.score, isRedFlag },
        },
        manager,
      );
      return { visitId: id, status: visit.status, vital, isRedFlag };
    });
  }

  private async notifyAssignment(
    visit: Visit,
    department: Department,
    manager: import('typeorm').EntityManager,
  ) {
    await this.notifications.create(
      {
        userId: visit.patientId,
        visitId: visit.id,
        type: 'CLINIC_ASSIGNED',
        title: 'Đã phân phòng khám',
        message: `${department.name}: số khám ${visit.clinicTicketNumber}.`,
      },
      manager,
    );
    const { businessDate, shiftType } = getBusinessTime(
      new Date(),
      this.config.queueIssuanceWindows,
    );
    if (!shiftType) return;
    const schedules = await manager.getRepository(DoctorSchedule).find({
      where: { departmentId: department.id, shiftDate: new Date(businessDate), shiftType },
    });
    await Promise.all(
      schedules.map((schedule) =>
        this.notifications.create(
          {
            userId: schedule.doctorId,
            visitId: visit.id,
            type: 'ROOM_QUEUE_UPDATED',
            title: 'Hàng đợi phòng khám cập nhật',
            message: `${visit.clinicTicketNumber} đã được phân vào ${department.code}.`,
          },
          manager,
        ),
      ),
    );
  }
}
