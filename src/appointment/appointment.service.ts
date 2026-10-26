import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { getBusinessTime } from '../visit/business-time';
import { clinicalConflict } from '../visit/clinical-error';
import { QueueTicketService } from '../visit/queue-ticket.service';
import { QueueTicketOperation } from '../visit/enums/queue-ticket.enum';
import { Role } from '../user/enums/role.enum';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { Appointment } from './entities/appointment.entity';
import { AppointmentStatus } from './enums/appointment-status.enum';

type Actor = { id: string; role: Role };

@Injectable()
export class AppointmentService {
  constructor(
    @InjectRepository(Appointment)
    private readonly appointments: Repository<Appointment>,
    private readonly queue: QueueTicketService,
    private readonly audit: AuditService,
  ) {}

  private response(appointment: Appointment) {
    return {
      id: appointment.id,
      appointmentCode: appointment.appointmentCode,
      scheduledAt: appointment.scheduledAt,
      status: appointment.status,
      chiefComplaint: appointment.chiefComplaint,
      checkedInAt: appointment.checkedInAt,
      visitId: appointment.visitId,
      cancelledAt: appointment.cancelledAt,
      cancellationReason: appointment.cancellationReason,
      patient: {
        id: appointment.patient.id,
        name: appointment.patient.name,
        nationalId: appointment.patient.nationalId,
        insuranceCardNumber: appointment.patient.insuranceCardNumber,
        dateOfBirth: appointment.patient.dateOfBirth,
      },
      department: appointment.department
        ? {
            id: appointment.department.id,
            code: appointment.department.code,
            name: appointment.department.name,
          }
        : null,
    };
  }

  async listToday(search?: string, status?: AppointmentStatus) {
    const { businessDate } = getBusinessTime();
    const start = new Date(`${businessDate}T00:00:00.000+07:00`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    const query = this.appointments
      .createQueryBuilder('appointment')
      .innerJoinAndSelect('appointment.patient', 'patient')
      .leftJoinAndSelect('appointment.department', 'department')
      .where('appointment.scheduled_at >= :start AND appointment.scheduled_at < :end', {
        start,
        end,
      })
      .orderBy('appointment.scheduled_at', 'ASC');
    if (status) query.andWhere('appointment.status = :status', { status });
    if (search?.trim()) {
      const term = `%${search.trim()}%`;
      query.andWhere(
        new Brackets((where) =>
          where
            .where('appointment.appointment_code ILIKE :term', { term })
            .orWhere('patient.name ILIKE :term', { term })
            .orWhere('patient.national_id ILIKE :term', { term }),
        ),
      );
    }
    return (await query.getMany()).map((appointment) => this.response(appointment));
  }

  async getById(id: string) {
    const appointment = await this.appointments.findOne({
      where: { id },
      relations: { patient: true, department: true },
    });
    if (!appointment) throw new NotFoundException('Appointment not found.');
    return this.response(appointment);
  }

  async cancel(id: string, dto: CancelAppointmentDto, actor: Actor) {
    const appointment = await this.appointments.findOne({ where: { id } });
    if (!appointment) throw new NotFoundException('Appointment not found.');
    if (appointment.status !== AppointmentStatus.BOOKED) {
      throw clinicalConflict(
        'APPOINTMENT_STATE_CONFLICT',
        'Only a booked appointment can be cancelled.',
      );
    }
    appointment.status = AppointmentStatus.CANCELLED;
    appointment.cancelledAt = new Date();
    appointment.cancellationReason = dto.reason.trim();
    await this.appointments.save(appointment);
    await this.audit.log({
      action: 'CANCEL_APPOINTMENT',
      actorId: actor.id,
      actorRole: actor.role,
      targetEntityType: 'Appointment',
      targetEntityId: appointment.id,
      metadata: {
        appointmentCode: appointment.appointmentCode,
        reason: appointment.cancellationReason,
      },
    });
    return { id: appointment.id, status: appointment.status, cancelledAt: appointment.cancelledAt };
  }

  async checkIn(id: string, actor: Actor, idempotencyHeader?: string) {
    const idempotencyKey = this.queue.requireIdempotencyKey(idempotencyHeader);
    const { businessDate, expiresAt } = this.queue.requireIssuanceWindow();
    const start = new Date(`${businessDate}T00:00:00.000+07:00`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    return this.queue.runAppointmentCheckIn(idempotencyKey, actor, id, async (manager) => {
      const appointment = await manager
        .getRepository(Appointment)
        .createQueryBuilder('appointment')
        .setLock('pessimistic_write')
        .where('appointment.id = :id', { id })
        .getOne();
      if (!appointment) throw new NotFoundException('Appointment not found.');
      const replay = await this.queue.replayAppointmentCheckIn(
        idempotencyKey,
        actor,
        appointment.id,
        manager,
      );
      if (replay) return replay;
      if (appointment.status !== AppointmentStatus.BOOKED) {
        throw clinicalConflict(
          'APPOINTMENT_STATE_CONFLICT',
          'Only a booked appointment can be checked in.',
        );
      }
      if (appointment.scheduledAt < start || appointment.scheduledAt >= end) {
        throw clinicalConflict(
          'APPOINTMENT_STATE_CONFLICT',
          'Only appointments scheduled for the current business date can be checked in.',
        );
      }

      const { visit, ticket } = await this.queue.issueReceptionHallTicket(manager, {
        patientId: appointment.patientId,
        actor,
        idempotencyKey,
        operation: QueueTicketOperation.HALL_APPOINTMENT_CHECK_IN,
        requestFingerprint: this.queue.fingerprint({
          actorId: actor.id,
          appointmentId: appointment.id,
          operation: QueueTicketOperation.HALL_APPOINTMENT_CHECK_IN,
        }),
        businessDate,
        expiresAt,
        chiefComplaint: appointment.chiefComplaint,
      });

      appointment.status = AppointmentStatus.CHECKED_IN;
      appointment.checkedInAt = new Date();
      appointment.checkedInById = actor.id;
      appointment.visitId = visit.id;
      await manager.getRepository(Appointment).save(appointment);
      await this.audit.log(
        {
          action: 'CHECK_IN_APPOINTMENT',
          actorId: actor.id,
          actorRole: actor.role,
          targetEntityType: 'Appointment',
          targetEntityId: appointment.id,
          metadata: {
            appointmentCode: appointment.appointmentCode,
            visitId: visit.id,
            hallTicketNumber: ticket.displayNumber,
            businessDate,
          },
        },
        manager,
      );
      return this.queue.ticketResponse(visit, ticket);
    });
  }
}
