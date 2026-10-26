import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../database/entities/user.entity';
import { Department } from '../../department/entities/department.entity';
import { VisitStatus } from '../enums/visit-status.enum';
import type { VisitVital } from './visit-vital.entity';
import type { VisitOrder } from './visit-order.entity';
import type { VisitStep } from './visit-step.entity';
import type { ReceptionRequest } from '../../reception-request/entities/reception-request.entity';

@Entity('visits')
export class Visit extends BaseEntity {
  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'patient_id' })
  patient: User;

  @Column({ type: 'varchar', length: 30 })
  @Index('idx_visits_hall_ticket')
  hallTicketNumber: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  @Index('idx_visits_clinic_ticket')
  clinicTicketNumber?: string;

  @Column({ name: 'receptionist_id', type: 'uuid', nullable: true })
  receptionistId?: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'receptionist_id' })
  receptionist?: User;

  @Column({ name: 'current_doctor_id', type: 'uuid', nullable: true })
  currentDoctorId?: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'current_doctor_id' })
  currentDoctor?: User;

  @Column({ name: 'initial_department_id', type: 'uuid', nullable: true })
  initialDepartmentId?: string;

  @ManyToOne(() => Department, { nullable: true })
  @JoinColumn({ name: 'initial_department_id' })
  initialDepartment?: Department;

  @Column({ name: 'current_department_id', type: 'uuid', nullable: true })
  currentDepartmentId?: string;

  @ManyToOne(() => Department, { nullable: true })
  @JoinColumn({ name: 'current_department_id' })
  currentDepartment?: Department;

  @Column({
    type: 'enum',
    enum: VisitStatus,
    default: VisitStatus.HALL_WAITING,
  })
  @Index('idx_visits_status')
  status: VisitStatus;

  @Column({ type: 'boolean', default: false })
  isPriority: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  priorityReason?: string;

  @Column({ type: 'text', nullable: true })
  chiefComplaint?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  symptomOnset?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  symptomDuration?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  symptomSeverity?: string;

  @Column({ type: 'boolean', default: false })
  isVerified: boolean;

  @Column({ name: 'hall_reissue_count', type: 'int', default: 0 })
  hallReissueCount: number;

  @Column({ name: 'intake_completed_at', type: 'timestamptz', nullable: true })
  intakeCompletedAt?: Date;

  @OneToOne('VisitVital', (vital: any) => vital.visit)
  vital?: VisitVital;

  @OneToOne('VisitOrder', (order: any) => order.visit)
  order?: VisitOrder;

  @OneToMany('VisitStep', (step: any) => step.visit)
  steps: VisitStep[];

  @OneToOne('ReceptionRequest', (request: any) => request.visit)
  receptionRequest?: ReceptionRequest;
}
