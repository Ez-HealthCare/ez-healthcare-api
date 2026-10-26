import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../database/entities/user.entity';
import { Department } from '../../department/entities/department.entity';
import { AppointmentStatus } from '../enums/appointment-status.enum';
import type { Visit } from '../../visit/entities/visit.entity';

@Entity('appointments')
@Index('uq_appointment_code', ['appointmentCode'], { unique: true })
@Index('idx_appointment_reception_queue', ['scheduledAt', 'status'])
@Index('idx_appointment_patient_scheduled', ['patientId', 'scheduledAt'])
@Index('uq_appointment_visit', ['visitId'], { unique: true, where: '"visit_id" IS NOT NULL' })
export class Appointment extends BaseEntity {
  @Column({ name: 'appointment_code', type: 'varchar', length: 30 })
  appointmentCode: string;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'patient_id' })
  patient: User;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId?: string;

  @ManyToOne(() => Department, { nullable: true })
  @JoinColumn({ name: 'department_id' })
  department?: Department;

  @Column({ name: 'scheduled_at', type: 'timestamptz' })
  scheduledAt: Date;

  @Column({ type: 'enum', enum: AppointmentStatus, default: AppointmentStatus.BOOKED })
  status: AppointmentStatus;

  @Column({ name: 'chief_complaint', type: 'text', nullable: true })
  chiefComplaint?: string;

  @Column({ name: 'checked_in_at', type: 'timestamptz', nullable: true })
  checkedInAt?: Date;

  @Column({ name: 'checked_in_by_id', type: 'uuid', nullable: true })
  checkedInById?: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'checked_in_by_id' })
  checkedInBy?: User;

  @Column({ name: 'visit_id', type: 'uuid', nullable: true })
  visitId?: string;

  @ManyToOne('Visit', { nullable: true })
  @JoinColumn({ name: 'visit_id' })
  visit?: Visit;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt?: Date;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason?: string;
}
