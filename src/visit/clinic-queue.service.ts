import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { MAX_QUEUE_CALL_ATTEMPTS } from '../common/constants/clinical.constants';
import { ApiConfigService } from '../config/api-config.service';
import { Department } from '../department/entities/department.entity';
import { DoctorSchedule } from '../department/entities/doctor-schedule.entity';
import { NotificationService } from '../notification/notification.service';
import { Role } from '../user/enums/role.enum';
import { getBusinessTime } from './business-time';
import { clinicalConflict, clinicalForbidden } from './clinical-error';
import { RequeueVisitDto } from './dto/queue-action.dto';
import { TransferClinicDto } from './dto/transfer-clinic.dto';
import { QueueTicket } from './entities/queue-ticket.entity';
import { Visit } from './entities/visit.entity';
import {
  QueueTicketKind,
  QueueTicketOperation,
  QueueTicketStatus,
} from './enums/queue-ticket.enum';
import { VisitStatus } from './enums/visit-status.enum';
import { QueueTicketService } from './queue-ticket.service';

@Injectable()
export class ClinicQueueService {
  constructor(
    @InjectRepository(DoctorSchedule)
    private readonly schedules: Repository<DoctorSchedule>,
    private readonly queue: QueueTicketService,
    private readonly config: ApiConfigService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  async getDoctorRooms(doctorId: string) {
    await this.queue.expireDueTickets();
    const { businessDate, shiftType } = getBusinessTime(
      new Date(),
      this.config.queueIssuanceWindows,
    );
    if (!shiftType) return [];
    const schedules = await this.schedules.find({
      where: { doctorId, shiftDate: new Date(businessDate), shiftType },
      relations: { department: true },
      order: { shiftType: 'ASC' },
    });
    return schedules.map((schedule) => ({
      code: schedule.department.code,
      name: schedule.department.name,
      shiftType: schedule.shiftType,
    }));
  }

  async getQueue(departmentCode: string, actor: { id: string; role: Role }) {
    await this.queue.expireDueTickets();
    const { businessDate } = getBusinessTime(new Date(), this.config.queueIssuanceWindows);
    const department = await this.schedules.manager
      .getRepository(Department)
      .findOne({ where: { code: departmentCode, isActive: true } });
    if (!department) {
      throw new NotFoundException(`Department with code ${departmentCode} not found`);
    }
    if (actor.role === Role.DOCTOR) {
      await this.queue.transaction((manager) =>
        this.assertDoctorAssignment(actor.id, department.id, manager),
      );
    }
    const tickets = await this.schedules.manager.getRepository(QueueTicket).find({
      where: {
        kind: QueueTicketKind.CLINIC,
        scopeKey: departmentCode,
        businessDate,
        status: In([QueueTicketStatus.ACTIVE, QueueTicketStatus.PAUSED]),
      },
      relations: { visit: { patient: true, vital: true } },
      order: { queuedAt: 'ASC' },
    });
    const waitingQueue = tickets
      .filter((ticket) =>
        [
          VisitStatus.CLINIC_WAITING,
          VisitStatus.CLINIC_CALLED,
          VisitStatus.TEMPORARILY_ABSENT,
        ].includes(ticket.visit.status),
      )
      .map((ticket) => ({
        visitId: ticket.visit.id,
        hallTicketNumber: ticket.visit.hallTicketNumber,
        clinicTicketNumber: ticket.visit.clinicTicketNumber,
        patientName: ticket.visit.patient?.name ?? '—',
        chiefComplaint: ticket.visit.chiefComplaint,
        status: ticket.visit.status,
        isPriority: ticket.visit.isPriority,
        priorityReason: ticket.visit.priorityReason,
        queuedAt: ticket.queuedAt,
        callAttempts: ticket.callAttempts,
        vitals: ticket.visit.vital
          ? {
              bp: `${ticket.visit.vital.bloodPressureSystolic}/${ticket.visit.vital.bloodPressureDiastolic}`,
              hr: ticket.visit.vital.heartRate,
              temp: ticket.visit.vital.temperature,
              spo2: ticket.visit.vital.spo2,
              isRedFlag: ticket.visit.vital.isRedFlag,
            }
          : null,
      }));

    // Retrieve active in-consultation, paraclinical pending, and priority re-exam visits assigned to this department
    const inProgressVisits = await this.schedules.manager.getRepository(Visit).find({
      where: {
        currentDepartmentId: department.id,
        status: In([
          VisitStatus.IN_EXAMINATION,
          VisitStatus.RE_EXAM_CALLING,
          VisitStatus.PARACLINICAL_PENDING,
        ]),
      },
      relations: { patient: true, vital: true },
      order: { updatedAt: 'DESC' },
    });

    const activeVisitIds = inProgressVisits.map((v) => v.id);
    let activeTickets: QueueTicket[] = [];
    if (activeVisitIds.length > 0) {
      activeTickets = await this.schedules.manager.getRepository(QueueTicket).find({
        where: {
          visitId: In(activeVisitIds),
          kind: QueueTicketKind.CLINIC,
        },
        order: { queuedAt: 'DESC' },
      });
    }
    const ticketByVisitId = new Map(activeTickets.map((t) => [t.visitId, t]));

    const inProgressQueue = inProgressVisits.map((v) => {
      const ticket = ticketByVisitId.get(v.id);
      return {
        visitId: v.id,
        hallTicketNumber: v.hallTicketNumber,
        clinicTicketNumber: v.clinicTicketNumber,
        patientName: v.patient?.name ?? '—',
        chiefComplaint: v.chiefComplaint,
        status: v.status,
        isPriority: v.isPriority,
        priorityReason: v.priorityReason,
        queuedAt: ticket?.queuedAt || v.updatedAt,
        callAttempts: ticket?.callAttempts || 0,
        vitals: v.vital
          ? {
              bp: `${v.vital.bloodPressureSystolic}/${v.vital.bloodPressureDiastolic}`,
              hr: v.vital.heartRate,
              temp: v.vital.temperature,
              spo2: v.vital.spo2,
              isRedFlag: v.vital.isRedFlag,
            }
          : null,
      };
    });

    const statusPriority: Record<string, number> = {
      [VisitStatus.IN_EXAMINATION]: 0,
      [VisitStatus.RE_EXAM_CALLING]: 1,
      [VisitStatus.CLINIC_CALLED]: 2,
      [VisitStatus.CLINIC_WAITING]: 3,
      [VisitStatus.PARACLINICAL_PENDING]: 4,
      [VisitStatus.TEMPORARILY_ABSENT]: 5,
    };

    const combinedQueue = [...inProgressQueue, ...waitingQueue].sort((a, b) => {
      const rankA = statusPriority[a.status] ?? 99;
      const rankB = statusPriority[b.status] ?? 99;
      if (rankA !== rankB) return rankA - rankB;
      if (b.isPriority !== a.isPriority) return Number(b.isPriority) - Number(a.isPriority);
      return new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime();
    });

    return {
      departmentCode: department.code,
      departmentName: department.name,
      queueLength: combinedQueue.length,
      queue: combinedQueue,
    };
  }

  private async assertDoctorAssignment(
    doctorId: string,
    departmentId: string | undefined,
    manager: EntityManager,
  ) {
    if (!departmentId) {
      throw clinicalForbidden('ROOM_ACCESS_DENIED', 'Visit is not assigned to a clinic room.');
    }
    const { businessDate, shiftType } = getBusinessTime(
      new Date(),
      this.config.queueIssuanceWindows,
    );
    if (!shiftType) throw clinicalForbidden('ROOM_ACCESS_DENIED', 'No active doctor shift.');
    const schedule = await manager.getRepository(DoctorSchedule).findOne({
      where: { doctorId, departmentId, shiftDate: new Date(businessDate), shiftType },
    });
    if (!schedule) {
      throw clinicalForbidden('ROOM_ACCESS_DENIED', 'Doctor is not assigned to this clinic room.');
    }
  }

  async callPatient(id: string, doctorId: string) {
    return this.queue.transaction(async (manager) => {
      await this.queue.expireDueTickets(new Date(), manager);
      const visit = await this.queue.lockVisit(manager, id);
      if (![VisitStatus.CLINIC_WAITING, VisitStatus.CLINIC_CALLED].includes(visit.status)) {
        throw clinicalConflict('VISIT_STATE_CONFLICT', 'Only a waiting patient can be called.');
      }
      await this.assertDoctorAssignment(doctorId, visit.currentDepartmentId, manager);
      const ticket = await this.queue.activeTicket(id, QueueTicketKind.CLINIC, manager);
      if (!ticket || ticket.status !== QueueTicketStatus.ACTIVE) {
        throw clinicalConflict('TICKET_EXPIRED', 'Visit has no active clinic ticket.');
      }
      ticket.callAttempts += 1;
      ticket.lastCalledAt = new Date();
      const absent = ticket.callAttempts >= MAX_QUEUE_CALL_ATTEMPTS;
      ticket.status = absent ? QueueTicketStatus.PAUSED : QueueTicketStatus.ACTIVE;
      visit.status = absent ? VisitStatus.TEMPORARILY_ABSENT : VisitStatus.CLINIC_CALLED;
      visit.currentDoctorId = doctorId;
      await manager.getRepository(QueueTicket).save(ticket);
      await manager.getRepository(Visit).save(visit);
      await this.notifications.create(
        {
          userId: visit.patientId,
          visitId: visit.id,
          type: absent ? 'TEMPORARILY_ABSENT' : 'PATIENT_CALLED',
          title: absent ? 'Tạm vắng' : 'Đến lượt khám',
          message: absent
            ? `Bạn đã vắng mặt sau ${ticket.callAttempts} lần gọi. Vui lòng liên hệ lễ tân.`
            : `Mời số ${visit.clinicTicketNumber} vào phòng khám.`,
        },
        manager,
      );
      await this.audit.log(
        {
          action: 'CALL_PATIENT',
          actorId: doctorId,
          actorRole: Role.DOCTOR,
          targetEntityType: 'Visit',
          targetEntityId: id,
          metadata: { status: visit.status },
        },
        manager,
      );
      return {
        visitId: id,
        status: visit.status,
        currentDoctorId: doctorId,
        callAttempts: ticket.callAttempts,
      };
    });
  }

  async startExamination(id: string, doctorId: string) {
    return this.queue.transaction(async (manager) => {
      await this.queue.expireDueTickets(new Date(), manager);
      const visit = await this.queue.lockVisit(manager, id);
      if (![VisitStatus.CLINIC_CALLED, VisitStatus.RE_EXAM_CALLING].includes(visit.status)) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'Call the patient before starting examination.',
        );
      }
      await this.assertDoctorAssignment(doctorId, visit.currentDepartmentId, manager);
      const ticket = await this.queue.activeTicket(id, QueueTicketKind.CLINIC, manager);
      if (ticket) {
        ticket.status = QueueTicketStatus.COMPLETED;
        await manager.getRepository(QueueTicket).save(ticket);
      }
      visit.status = VisitStatus.IN_EXAMINATION;
      visit.currentDoctorId = doctorId;
      await manager.getRepository(Visit).save(visit);
      await this.audit.log(
        {
          action: 'START_EXAMINATION',
          actorId: doctorId,
          actorRole: Role.DOCTOR,
          targetEntityType: 'Visit',
          targetEntityId: id,
          metadata: { status: visit.status },
        },
        manager,
      );
      return { visitId: id, status: visit.status, currentDoctorId: doctorId };
    });
  }

  async requeueVisit(id: string, dto: RequeueVisitDto, actor: { id: string; role: Role }) {
    return this.queue.transaction(async (manager) => {
      await this.queue.expireDueTickets(new Date(), manager);
      const visit = await this.queue.lockVisit(manager, id);
      if (visit.status !== VisitStatus.TEMPORARILY_ABSENT) {
        throw clinicalConflict(
          'VISIT_STATE_CONFLICT',
          'Only a temporarily absent visit can be requeued.',
        );
      }
      const ticket = await this.queue.activeTicket(id, QueueTicketKind.CLINIC, manager);
      if (!ticket || ticket.status !== QueueTicketStatus.PAUSED) {
        throw clinicalConflict('TICKET_EXPIRED', 'Paused clinic ticket not found.');
      }
      ticket.status = QueueTicketStatus.ACTIVE;
      ticket.callAttempts = 0;
      ticket.queuedAt = new Date();
      visit.status = VisitStatus.CLINIC_WAITING;
      await manager.getRepository(QueueTicket).save(ticket);
      await manager.getRepository(Visit).save(visit);
      await this.notifications.create(
        {
          userId: visit.patientId,
          visitId: id,
          type: 'VISIT_REQUEUED',
          title: 'Đã đưa lại vào hàng đợi',
          message: `Số ${visit.clinicTicketNumber} đã được đưa về cuối hàng đợi.`,
          metadata: { reason: dto.reason },
        },
        manager,
      );
      await this.audit.log(
        {
          action: 'REQUEUE_VISIT',
          actorId: actor.id,
          actorRole: actor.role,
          targetEntityType: 'Visit',
          targetEntityId: id,
          metadata: { reason: dto.reason },
        },
        manager,
      );
      return { visitId: id, status: visit.status, clinicTicketNumber: visit.clinicTicketNumber };
    });
  }

  async transferClinic(
    id: string,
    dto: TransferClinicDto,
    actor: { id: string; role: Role },
    idempotencyHeader?: string,
  ) {
    const idempotencyKey = this.queue.requireIdempotencyKey(idempotencyHeader);
    const { businessDate, expiresAt } = this.queue.requireIssuanceWindow();
    const operation = QueueTicketOperation.CLINIC_TRANSFER;
    const fingerprint = this.queue.fingerprint({
      actorId: actor.id,
      operation,
      visitId: id,
      targetDepartmentCode: dto.targetDepartmentCode,
      transferReason: dto.transferReason,
    });
    return this.queue.runIdempotent(
      idempotencyKey,
      { actor, operation, fingerprint, visitId: id },
      async (manager) => {
        const visit = await this.queue.lockVisit(manager, id);
        if (visit.status !== VisitStatus.IN_EXAMINATION) {
          throw clinicalConflict(
            'VISIT_STATE_CONFLICT',
            'Only the examining doctor may transfer this visit.',
          );
        }
        await this.assertDoctorAssignment(actor.id, visit.currentDepartmentId, manager);
        const target = await manager
          .getRepository(Department)
          .findOne({ where: { code: dto.targetDepartmentCode, isActive: true } });
        if (!target)
          throw new NotFoundException(`Target clinic ${dto.targetDepartmentCode} not found`);
        const sequence = await this.queue.nextSequence(
          manager,
          QueueTicketKind.CLINIC,
          target.code,
          businessDate,
        );
        const displayNumber = this.queue.displayNumber(
          QueueTicketKind.CLINIC,
          target.code,
          sequence,
        );
        const ticketRepo = manager.getRepository(QueueTicket);
        const ticket = await ticketRepo.save(
          ticketRepo.create({
            visitId: id,
            kind: QueueTicketKind.CLINIC,
            scopeKey: target.code,
            businessDate,
            sequence,
            displayNumber,
            status: QueueTicketStatus.ACTIVE,
            issuedById: actor.id,
            reissueReason: dto.transferReason,
            idempotencyKey,
            operation,
            requestFingerprint: fingerprint,
            queuedAt: new Date(),
            expiresAt,
          }),
        );
        Object.assign(visit, {
          currentDepartmentId: target.id,
          currentDoctorId: undefined,
          clinicTicketNumber: displayNumber,
          status: VisitStatus.CLINIC_WAITING,
          isPriority: true,
          priorityReason: `Transferred: ${dto.transferReason}`,
        });
        await manager.getRepository(Visit).save(visit);
        await this.notifications.create(
          {
            userId: visit.patientId,
            visitId: id,
            type: 'CLINIC_ASSIGNED',
            title: 'Đã phân phòng khám',
            message: `${target.name}: số khám ${displayNumber}.`,
          },
          manager,
        );
        await this.audit.log(
          {
            action: 'TRANSFER_CLINIC',
            actorId: actor.id,
            actorRole: actor.role,
            targetEntityType: 'Visit',
            targetEntityId: id,
            metadata: { targetDepartmentCode: target.code, reason: dto.transferReason },
          },
          manager,
        );
        return { ...this.queue.ticketResponse(visit, ticket), targetDepartmentName: target.name };
      },
    );
  }
}
