import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import {
  ELDERLY_PRIORITY_AGE,
  MAX_PATIENT_HALL_REISSUES,
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
import { RejectVerificationDto, VerifyVisitDto } from './dto/verify-visit.dto';
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
import { assertTransition } from './visit-state-machine';

type Actor = { id: string; role: Role };

@Injectable()
export class ReceptionService {
  constructor(
    @InjectRepository(QueueTicket)
    private readonly tickets: Repository<QueueTicket>,
    private readonly queue: QueueTicketService,
    private readonly config: ApiConfigService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  private queueVisit(ticket: QueueTicket) {
    const visit = ticket.visit;
    return {
      visitId: visit.id,
      hallTicketNumber: visit.hallTicketNumber,
      clinicTicketNumber: visit.clinicTicketNumber,
      status: visit.status,
      ticketStatus: ticket.status,
      businessDate: ticket.businessDate,
      expiresAt: ticket.expiresAt,
      patient: {
        id: visit.patient.id,
        name: visit.patient.name,
        dateOfBirth: visit.patient.dateOfBirth,
        nationalId: visit.patient.nationalId,
        insuranceCardNumber: visit.patient.insuranceCardNumber,
        allergies: visit.patient.allergies,
      },
      chiefComplaint: visit.chiefComplaint,
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
    return {
      visitId: visit.id,
      hallTicketNumber: visit.hallTicketNumber,
      clinicTicketNumber: visit.clinicTicketNumber,
      status: visit.status,
      room: visit.currentDepartment
        ? { code: visit.currentDepartment.code, name: visit.currentDepartment.name }
        : null,
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

  async getReceptionQueue() {
    await this.queue.expireDueTickets();
    const { businessDate } = getBusinessTime(new Date(), this.config.queueIssuanceWindows);
    const tickets = await this.tickets.find({
      where: {
        businessDate,
        status: In([QueueTicketStatus.ACTIVE, QueueTicketStatus.PAUSED]),
      },
      relations: {
        visit: { patient: true, vital: true, currentDepartment: true },
      },
      order: { queuedAt: 'ASC' },
    });
    const latest = new Map<string, QueueTicket>();
    for (const ticket of tickets) {
      const current = latest.get(ticket.visitId);
      if (!current || ticket.kind === QueueTicketKind.CLINIC) latest.set(ticket.visitId, ticket);
    }
    return [...latest.values()]
      .filter((ticket) =>
        [
          VisitStatus.HALL_WAITING,
          VisitStatus.RECEPTION_VERIFIED,
          VisitStatus.TRIAGE_PENDING,
          VisitStatus.CLINIC_WAITING,
          VisitStatus.CLINIC_CALLED,
          VisitStatus.TEMPORARILY_ABSENT,
        ].includes(ticket.visit.status),
      )
      .sort(
        (a, b) =>
          Number(b.visit.isPriority) - Number(a.visit.isPriority) ||
          a.queuedAt.getTime() - b.queuedAt.getTime(),
      )
      .map((ticket) => this.queueVisit(ticket));
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
    return [...latest.values()].map((ticket) => this.queueVisit(ticket));
  }

  async verifyVisit(id: string, dto: VerifyVisitDto, actor: Actor) {
    return this.queue.transaction(async (manager) => {
      const visit = await this.queue.lockVisit(manager, id);
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
      await manager.getRepository(Visit).save(visit);
      if (!dto.nationalIdVerified) {
        await manager
          .getRepository(QueueTicket)
          .createQueryBuilder()
          .update(QueueTicket)
          .set({ status: QueueTicketStatus.SUPERSEDED })
          .where('visit_id = :id', { id })
          .andWhere('status IN (:...statuses)', {
            statuses: [QueueTicketStatus.ACTIVE, QueueTicketStatus.PAUSED],
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
          statuses: [QueueTicketStatus.ACTIVE, QueueTicketStatus.PAUSED],
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
