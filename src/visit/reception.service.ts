import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Not, IsNull, MoreThan, Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { ELDERLY_PRIORITY_AGE, VN_OFFSET_MS } from '../common/constants/clinical.constants';
import { ApiConfigService } from '../config/api-config.service';
import { User } from '../database/entities/user.entity';
import { Department } from '../department/entities/department.entity';
import { DoctorSchedule } from '../department/entities/doctor-schedule.entity';
import { RoomType } from '../department/enums/room-type.enum';
import { NotificationService } from '../notification/notification.service';
import { Role } from '../user/enums/role.enum';
import { getBusinessTime } from './business-time';
import { clinicalConflict, clinicalForbidden } from './clinical-error';
import { AssignClinicDto } from './dto/assign-clinic.dto';
import { RecordIntakeDto } from './dto/record-intake.dto';
import { ReceptionRecordsQueryDto } from './dto/reception-records-query.dto';
import { RejectVerificationDto, VerifyVisitDto } from './dto/verify-visit.dto';
import { PauseHallTicketDto } from './dto/queue-action.dto';
import { ReceptionDeskShift } from './entities/reception-desk-shift.entity';
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
import { ageOnDate } from './hall-priority';
import { estimateReceptionStart } from './reception-eta';
import { ReceptionEtaForecast } from './entities/reception-eta-forecast.entity';
import { refreshReceptionEtaHistory } from './reception-eta-history';
import { compareReadyQueue } from './ready-queue';
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

  private receptionTransaction<T>(operation: (manager: EntityManager) => Promise<T>) {
    return this.queue.transaction(async (manager) => {
      if (this.config.receptionDeskShiftsEnabled) {
        await manager.query("SELECT pg_advisory_xact_lock(hashtext('reception-desk-queue'))");
      }
      const result = await operation(manager);
      await refreshReceptionEtaHistory(manager, this.config);
      return result;
    });
  }

  private async currentDesk(manager: EntityManager, receptionistId: string) {
    const { businessDate, shiftType } = getBusinessTime(
      new Date(),
      this.config.queueIssuanceWindows,
    );
    if (!shiftType) return null;
    return manager
      .getRepository(ReceptionDeskShift)
      .findOneBy({ businessDate, shiftType, receptionistId });
  }

  private async requireDesk(manager: EntityManager, receptionistId: string) {
    const desk = await this.currentDesk(manager, receptionistId);
    if (!desk) {
      throw clinicalForbidden(
        'RECEPTION_DESK_ACCESS_DENIED',
        'Bạn chưa được phân quầy trong ca hiện tại.',
      );
    }
    return desk;
  }

  private async heldTicket(manager: EntityManager, deskCode: string) {
    return manager.getRepository(QueueTicket).findOneBy({
      kind: QueueTicketKind.HALL,
      status: QueueTicketStatus.CALLED,
      receptionDeskCode: deskCode,
      expiresAt: MoreThan(new Date()),
    });
  }

  private async requireFreeDesk(manager: EntityManager, desk: ReceptionDeskShift) {
    if (await this.heldTicket(manager, desk.deskCode)) {
      throw clinicalConflict('RECEPTION_DESK_BUSY', 'Quầy đang giữ một lượt tiếp nhận.');
    }
  }

  async getReceptionDesk(receptionistId: string) {
    const manager = this.tickets.manager;
    const desk = await this.currentDesk(manager, receptionistId);
    if (!desk) return null;
    const held = await this.heldTicket(manager, desk.deskCode);
    return {
      code: desk.deskCode,
      name: 'Quầy tiếp đón ' + desk.deskCode,
      businessDate: desk.businessDate,
      shiftType: desk.shiftType,
      acceptingCalls: desk.acceptingCalls,
      workflowEnabled: this.config.receptionDeskShiftsEnabled,
      occupied: !!held,
      currentVisitId: held?.receptionDeskShiftId === desk.id ? held.visitId : null,
    };
  }

  async setReceptionDeskAvailability(actor: Actor, acceptingCalls: boolean) {
    if (!this.config.receptionDeskShiftsEnabled) throw new NotFoundException();
    return this.receptionTransaction(async (manager) => {
      const desk = await this.requireDesk(manager, actor.id);
      if (desk.acceptingCalls !== acceptingCalls) {
        desk.acceptingCalls = acceptingCalls;
        await manager.getRepository(ReceptionDeskShift).save(desk);
        await this.audit.log(
          {
            action: acceptingCalls ? 'RESUME_RECEPTION_DESK' : 'PAUSE_RECEPTION_DESK',
            actorId: actor.id,
            actorRole: actor.role,
            targetEntityType: 'ReceptionDeskShift',
            targetEntityId: desk.id,
            metadata: { deskCode: desk.deskCode },
          },
          manager,
        );
      }
      return { code: desk.deskCode, acceptingCalls };
    });
  }

  private async assertDeskOwnsTicket(manager: EntityManager, ticket: QueueTicket, actor: Actor) {
    const shift = ticket.receptionDeskShiftId
      ? await manager
          .getRepository(ReceptionDeskShift)
          .findOneBy({ id: ticket.receptionDeskShiftId })
      : null;
    if (!shift || shift.receptionistId !== actor.id) {
      throw clinicalForbidden(
        'RECEPTION_DESK_ACCESS_DENIED',
        'Lượt tiếp nhận chưa được gắn với quầy của bạn.',
      );
    }
  }

  async startVerification(id: string, actor: Actor) {
    if (!this.config.receptionDeskShiftsEnabled) throw new NotFoundException();
    return this.receptionTransaction(async (manager) => {
      const visit = await this.queue.lockVisit(manager, id);
      const ticket = await this.queue.activeTicket(id, QueueTicketKind.HALL, manager);
      if (
        visit.status !== VisitStatus.HALL_WAITING ||
        ticket?.status !== QueueTicketStatus.CALLED
      ) {
        throw clinicalConflict('VISIT_STATE_CONFLICT', 'Chỉ bắt đầu xác minh lượt đã được gọi.');
      }
      if (!ticket.receptionDeskShiftId) {
        const desk = await this.requireDesk(manager, actor.id);
        if (!desk.acceptingCalls) {
          throw clinicalConflict('RECEPTION_DESK_PAUSED', 'Hãy mở lại quầy trước khi nhận lượt.');
        }
        await this.requireFreeDesk(manager, desk);
        ticket.receptionDeskShiftId = desk.id;
        ticket.receptionDeskCode = desk.deskCode;
      } else {
        await this.assertDeskOwnsTicket(manager, ticket, actor);
      }
      if (!ticket.verificationStartedAt) {
        ticket.verificationStartedAt = new Date();
        await manager.getRepository(QueueTicket).save(ticket);
        if (this.config.receptionEta) {
          await manager
            .getRepository(ReceptionEtaForecast)
            .update(
              { ticketId: ticket.id, queuedAt: ticket.queuedAt, actualStartedAt: IsNull() },
              { actualStartedAt: ticket.verificationStartedAt },
            );
        }
        await this.audit.log(
          {
            action: 'START_RECEPTION_VERIFICATION',
            actorId: actor.id,
            actorRole: actor.role,
            targetEntityType: 'Visit',
            targetEntityId: id,
            metadata: {
              ticketId: ticket.id,
              deskCode: ticket.receptionDeskCode,
              startedAt: ticket.verificationStartedAt,
            },
          },
          manager,
        );
      }
      return { visitId: id, ...this.receptionTicketDetails(ticket) };
    });
  }

  private receptionTicketDetails(ticket?: QueueTicket) {
    return {
      receptionDeskCode: ticket?.receptionDeskCode ?? null,
      verificationStartedAt: ticket?.verificationStartedAt ?? null,
      receptionReleasedAt: ticket?.receptionReleasedAt ?? null,
    };
  }

  private async completeDeskVerification(
    manager: EntityManager,
    ticket: QueueTicket,
    actor: Actor,
  ) {
    if (!this.config.receptionDeskShiftsEnabled) return;
    if (!ticket.verificationStartedAt) {
      throw clinicalConflict(
        'VERIFICATION_NOT_STARTED',
        'Hãy bắt đầu xác minh trước khi gửi kết quả.',
      );
    }
    await this.assertDeskOwnsTicket(manager, ticket, actor);
    ticket.receptionReleasedAt = new Date();
    await manager.getRepository(QueueTicket).save(ticket);
  }

  private queueVisit(visit: Visit, ticket?: QueueTicket) {
    return {
      visitId: visit.id,
      hallTicketNumber: visit.hallTicketNumber,
      clinicTicketNumber: visit.clinicTicketNumber,
      status: visit.status,
      returnReportedAt: visit.returnReportedAt,
      ...this.receptionTicketDetails(ticket),
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
        age: ageOnDate(
          visit.patient.dateOfBirth,
          ticket?.businessDate ??
            getBusinessTime(new Date(), this.config.queueIssuanceWindows).businessDate,
        ),
        isPregnant: visit.patient.gender === 'FEMALE' && !!visit.patient.isPregnant,
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
      hallReissued: ticket?.kind === QueueTicketKind.HALL && !!ticket.reissueOfId,
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
      ...this.receptionTicketDetails(ticket.kind === QueueTicketKind.HALL ? ticket : undefined),
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
      ticketStatus: ticket.status,
      businessDate: ticket.businessDate,
      expiresAt: ticket.expiresAt,
      intakeCompleted: !!visit.intakeCompletedAt,
    };
  }

  async confirmStageArrival(id: string, actor: Actor, station: string, ticketNumber?: string) {
    if (!this.config.downstreamEta) throw new NotFoundException();
    return this.queue.transaction(async (manager) => {
      const visit = await this.queue.lockVisit(manager, id);
      if (actor.role === Role.PATIENT && visit.patientId !== actor.id)
        throw new NotFoundException();
      const staffAllowed =
        station === 'triage' ? actor.role === Role.NURSE : actor.role === Role.DOCTOR;
      if (actor.role !== Role.PATIENT && !staffAllowed) throw new NotFoundException();
      const expected =
        station === 'triage' ? VisitStatus.TRIAGE_PENDING : VisitStatus.CLINIC_WAITING;
      if (!['triage', 'clinic'].includes(station) || visit.status !== expected) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'The visit is no longer waiting at this station.',
        );
      }
      const alreadyArrived = station === 'triage' ? visit.triageArrivedAt : visit.clinicArrivedAt;
      if (station === 'triage') {
        if (visit.intakeCompletedAt)
          throw clinicalConflict('VISIT_STATE_CONFLICT', 'Triage already completed.');
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
        if (actor.role === Role.DOCTOR) {
          const { shiftType, businessDate } = getBusinessTime(
            new Date(),
            this.config.queueIssuanceWindows,
          );
          const schedule =
            shiftType &&
            visit.currentDepartmentId &&
            (await manager.getRepository(DoctorSchedule).findOneBy({
              doctorId: actor.id,
              departmentId: visit.currentDepartmentId,
              shiftDate: new Date(businessDate),
              shiftType,
            }));
          if (!schedule) throw new NotFoundException();
        }
        visit.clinicArrivedAt ??= new Date();
      }
      if (!alreadyArrived) {
        await manager.getRepository(Visit).save(visit);
        await this.audit.log(
          {
            action: 'CONFIRM_STATION_ARRIVAL',
            actorId: actor.id,
            actorRole: actor.role,
            targetEntityType: 'Visit',
            targetEntityId: id,
            metadata: { station, ticketNumber },
          },
          manager,
        );
      }
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
      if (visit.triageStartedAt) return { started: true };
      if (!visit.triageArrivedAt) {
        throw clinicalConflict('VISIT_STATE_CONFLICT', 'Confirm arrival before starting triage.');
      }
      await manager.query("SELECT pg_advisory_xact_lock(hashtext('triage-ready-queue'))");
      const rows = await manager.getRepository(Visit).findBy({
        status: VisitStatus.TRIAGE_PENDING,
        intakeCompletedAt: IsNull(),
        triageArrivedAt: Not(IsNull()),
      });
      const config = this.config.downstreamEta;
      if (!config) throw new NotFoundException();
      const { businessDate } = getBusinessTime(new Date(), this.config.queueIssuanceWindows);
      const today = rows.filter(
        (row) =>
          new Date(row.triageArrivedAt!.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10) ===
          businessDate,
      );
      if (today.filter((row) => row.triageStartedAt).length >= config.triageCounters) {
        throw clinicalConflict('VISIT_STATE_CONFLICT', 'All triage counters are occupied.');
      }
      const next = today
        .filter((row) => !row.triageStartedAt)
        .sort((a, b) =>
          compareReadyQueue(
            { visitId: a.id, isPriority: a.isPriority, readyAt: a.triageArrivedAt },
            { visitId: b.id, isPriority: b.isPriority, readyAt: b.triageArrivedAt },
          ),
        )[0];
      if (next?.id !== id) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'Start triage with the next eligible patient.',
        );
      }
      visit.triageStartedAt = new Date();
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

    waiting.sort((a, b) =>
      compareReadyQueue(
        { visitId: a.id, isPriority: a.isPriority, readyAt: arrivedAt(a) },
        { visitId: b.id, isPriority: b.isPriority, readyAt: arrivedAt(b) },
      ),
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
    if (
      !this.config.receptionEta ||
      ticket.kind !== QueueTicketKind.HALL ||
      ticket.status !== QueueTicketStatus.ACTIVE ||
      ticket.visit.status !== VisitStatus.HALL_WAITING
    ) {
      return undefined;
    }
    const forecast = await this.tickets.manager.getRepository(ReceptionEtaForecast).findOne({
      where: { ticketId: ticket.id, queuedAt: ticket.queuedAt },
      order: { version: 'DESC' },
    });
    return forecast
      ? { estimatedStartAt: forecast.estimatedStartAt, calculatedAt: forecast.calculatedAt }
      : { estimatedStartAt: null, calculatedAt: new Date() };
  }

  refreshEtaHistory() {
    return this.queue.transaction((manager) => refreshReceptionEtaHistory(manager, this.config));
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
          Number(!b.reissueOfId && b.visit.isPriority) -
            Number(!a.reissueOfId && a.visit.isPriority) ||
          a.queuedAt.getTime() - b.queuedAt.getTime() ||
          a.sequence - b.sequence,
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
    const config = this.config.downstreamEta;
    const { businessDate } = getBusinessTime(new Date(), this.config.queueIssuanceWindows);
    const isReadyToday = (visit: Visit) =>
      visit.triageArrivedAt &&
      new Date(visit.triageArrivedAt.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10) ===
        businessDate;
    let next: Visit | undefined;
    if (config) {
      visits.sort((a, b) =>
        compareReadyQueue(
          { visitId: a.id, isPriority: a.isPriority, readyAt: a.triageArrivedAt },
          { visitId: b.id, isPriority: b.isPriority, readyAt: b.triageArrivedAt },
        ),
      );
      const eligible = visits.filter((visit) => isReadyToday(visit) && !visit.intakeCompletedAt);
      if (eligible.filter((visit) => visit.triageStartedAt).length < config.triageCounters) {
        next = eligible.find((visit) => !visit.triageStartedAt);
      }
    }
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
      canStartTriage: next?.id === visit.id,
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
    return this.receptionTransaction(async (manager) => {
      if (this.config.receptionDeskShiftsEnabled) {
        await this.queue.expireDueTickets(new Date(), manager);
        const desk = await this.requireDesk(manager, actor.id);
        const next = await this.findNextHallTicket(
          manager.getRepository(QueueTicket),
          desk.businessDate,
        );
        if (next?.visitId !== id) {
          throw clinicalConflict('VISIT_STATE_CONFLICT', 'Hãy gọi lượt đủ điều kiện đầu hàng.');
        }
        return this.claimHallTicket(manager, id, actor, desk);
      }
      return this.claimHallTicket(manager, id, actor);
    });
  }

  private async claimHallTicket(
    manager: EntityManager,
    id: string,
    actor: Actor,
    desk?: ReceptionDeskShift,
  ) {
    if (desk) {
      if (!desk.acceptingCalls) {
        throw clinicalConflict('RECEPTION_DESK_PAUSED', 'Quầy đang tạm ngừng nhận lượt mới.');
      }
      await this.requireFreeDesk(manager, desk);
    }
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
    if (desk) {
      ticket.receptionDeskShiftId = desk.id;
      ticket.receptionDeskCode = desk.deskCode;
      ticket.verificationStartedAt = null;
      ticket.receptionReleasedAt = null;
    }
    await manager.getRepository(QueueTicket).save(ticket);
    await this.notifications.create(
      {
        userId: visit.patientId,
        visitId: visit.id,
        type: 'HALL_TICKET_CALLED',
        title: 'Mời đến quầy tiếp nhận',
        message: `Mời số ${visit.hallTicketNumber} đến ${desk ? `Quầy tiếp đón ${desk.deskCode}` : 'quầy tiếp nhận'}.`,
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
        metadata: {
          hallTicketNumber: visit.hallTicketNumber,
          callAttempts: ticket.callAttempts,
          deskCode: ticket.receptionDeskCode,
        },
      },
      manager,
    );
    return {
      visitId: id,
      status: visit.status,
      ticketStatus: ticket.status,
      callAttempts: ticket.callAttempts,
      lastCalledAt: ticket.lastCalledAt,
      ...this.receptionTicketDetails(ticket),
    };
  }

  async callNextHallTicket(actor: Actor) {
    return this.receptionTransaction(async (manager) => {
      await this.queue.expireDueTickets(new Date(), manager);
      const { businessDate } = getBusinessTime(new Date(), this.config.queueIssuanceWindows);
      const desk = this.config.receptionDeskShiftsEnabled
        ? await this.requireDesk(manager, actor.id)
        : undefined;
      const next = await this.findNextHallTicket(manager.getRepository(QueueTicket), businessDate);
      if (!next) throw new NotFoundException('No patient is waiting at reception.');
      return this.claimHallTicket(manager, next.visitId, actor, desk);
    });
  }

  private findNextHallTicket(tickets: Repository<QueueTicket>, businessDate: string) {
    return tickets
      .createQueryBuilder('ticket')
      .innerJoinAndSelect('ticket.visit', 'visit')
      .where('ticket.kind = :kind', { kind: QueueTicketKind.HALL })
      .andWhere('ticket.business_date = :businessDate', { businessDate })
      .andWhere('ticket.status = :ticketStatus', { ticketStatus: QueueTicketStatus.ACTIVE })
      .andWhere('visit.status = :visitStatus', { visitStatus: VisitStatus.HALL_WAITING })
      .orderBy(
        'CASE WHEN ticket.reissue_of_id IS NULL AND visit."isPriority" THEN 1 ELSE 0 END',
        'DESC',
      )
      .addOrderBy('ticket.queued_at', 'ASC')
      .addOrderBy('ticket.sequence', 'ASC')
      .getOne();
  }

  async pauseHallTicket(id: string, dto: PauseHallTicketDto, actor: Actor) {
    return this.receptionTransaction(async (manager) => {
      const visit = await this.queue.lockVisit(manager, id);
      if (visit.status !== VisitStatus.HALL_WAITING) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'Only a patient waiting at reception can be temporarily skipped.',
        );
      }
      const ticket = await this.queue.activeTicket(id, QueueTicketKind.HALL, manager);
      if (!ticket) {
        throw clinicalConflict('TICKET_EXPIRED', 'Visit has no active hall ticket.');
      }
      if (
        ticket.status !== QueueTicketStatus.ACTIVE &&
        ticket.status !== QueueTicketStatus.CALLED
      ) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'Only waiting or called tickets can be paused.',
        );
      }
      if (this.config.receptionDeskShiftsEnabled && ticket.status === QueueTicketStatus.CALLED) {
        if (ticket.receptionDeskShiftId) await this.assertDeskOwnsTicket(manager, ticket, actor);
        else await this.requireDesk(manager, actor.id);
        ticket.receptionReleasedAt = new Date();
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
          metadata: {
            hallTicketNumber: visit.hallTicketNumber,
            reason: dto.reason.trim(),
            deskCode: ticket.receptionDeskCode,
            releasedAt: ticket.receptionReleasedAt,
          },
        },
        manager,
      );
      return { visitId: id, status: visit.status, ticketStatus: ticket.status };
    });
  }

  async recallHallTicket(id: string, actor: Actor) {
    return this.receptionTransaction(async (manager) => {
      const visit = await this.queue.lockVisit(manager, id);
      if (visit.status !== VisitStatus.HALL_WAITING) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'Only a patient waiting at reception can be recalled.',
        );
      }
      const ticket = await this.queue.activeTicket(id, QueueTicketKind.HALL, manager);
      if (!ticket) throw clinicalConflict('TICKET_EXPIRED', 'Hall ticket not found.');
      if (ticket.status === QueueTicketStatus.PAUSED) {
        if (ticket.callAttempts > 3) {
          throw clinicalConflict(
            'VISIT_STATE_CONFLICT',
            'Vé đã quá 3 lần gọi và cần được cấp lại.',
          );
        }
        ticket.status = QueueTicketStatus.ACTIVE;
        ticket.queuedAt = new Date();
        if (this.config.receptionDeskShiftsEnabled) {
          ticket.receptionDeskShiftId = null;
          ticket.receptionDeskCode = null;
          ticket.verificationStartedAt = null;
        }
      } else if (ticket.status === QueueTicketStatus.CALLED) {
        if (this.config.receptionDeskShiftsEnabled) {
          await this.assertDeskOwnsTicket(manager, ticket, actor);
          if (ticket.verificationStartedAt) {
            throw clinicalConflict('VISIT_STATE_CONFLICT', 'Lượt đã bắt đầu xác minh.');
          }
        }
        ticket.callAttempts += 1;
        ticket.lastCalledAt = new Date();
        await this.notifications.create(
          {
            userId: visit.patientId,
            visitId: visit.id,
            type: 'HALL_TICKET_CALLED',
            title: 'Mời đến quầy tiếp nhận',
            message: `Mời lại số ${visit.hallTicketNumber} đến ${ticket.receptionDeskCode ? `Quầy tiếp đón ${ticket.receptionDeskCode}` : 'quầy tiếp nhận'}.`,
          },
          manager,
        );
      } else {
        throw clinicalConflict('VISIT_STATE_CONFLICT', 'Chỉ gọi lại vé đã gọi hoặc đã tạm hoãn.');
      }
      await manager.getRepository(QueueTicket).save(ticket);
      await this.audit.log(
        {
          action: 'RECALL_HALL_TICKET',
          actorId: actor.id,
          actorRole: actor.role,
          targetEntityType: 'Visit',
          targetEntityId: id,
          metadata: {
            hallTicketNumber: visit.hallTicketNumber,
            callAttempts: ticket.callAttempts,
            deskCode: ticket.receptionDeskCode,
          },
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
    return this.receptionTransaction(async (manager) => {
      const visit = await this.queue.lockVisit(manager, id);
      const hallTicket = await this.queue.activeTicket(id, QueueTicketKind.HALL, manager);
      if (!hallTicket || hallTicket.status !== QueueTicketStatus.CALLED) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'Only the patient currently called to the reception desk can be verified.',
        );
      }
      await this.completeDeskVerification(manager, hallTicket, actor);
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
    return this.receptionTransaction(async (manager) => {
      const visit = await this.queue.lockVisit(manager, id);
      const hallTicket = await this.queue.activeTicket(id, QueueTicketKind.HALL, manager);
      if (!hallTicket || hallTicket.status !== QueueTicketStatus.CALLED) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'Only the patient currently called to the reception desk can be rejected.',
        );
      }
      await this.completeDeskVerification(manager, hallTicket, actor);
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
      if (
        this.config.downstreamEta &&
        visit.status === VisitStatus.TRIAGE_PENDING &&
        !visit.triageStartedAt &&
        !visit.intakeCompletedAt
      ) {
        throw clinicalConflict('VISIT_STATE_CONFLICT', 'Start triage before saving intake.');
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
