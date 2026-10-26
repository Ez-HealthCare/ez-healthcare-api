import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../database/entities/user.entity';
import type { Visit } from '../../visit/entities/visit.entity';
import { ReceptionRequestStatus } from '../enums/reception-request-status.enum';

/**
 * Administrative intake requested by a patient.
 *
 * This is intentionally not a Visit: there is no clinical encounter or queue
 * number until a receptionist has completed identity verification.
 */
@Entity('reception_requests')
@Index('idx_reception_requests_patient_status', ['patientId', 'status'])
@Index('idx_reception_requests_status_created', ['status', 'createdAt'])
export class ReceptionRequest extends BaseEntity {
  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'patient_id' })
  patient: User;

  @Column({
    type: 'enum',
    enum: ReceptionRequestStatus,
    default: ReceptionRequestStatus.DRAFT,
  })
  status: ReceptionRequestStatus;

  @Column({ name: 'business_date', type: 'date', nullable: true })
  businessDate?: string;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt?: Date;

  @Column({ name: 'chief_complaint', type: 'text', nullable: true })
  chiefComplaint?: string;

  @Column({ name: 'symptom_codes', type: 'text', array: true, nullable: true })
  symptomCodes?: string[];

  @Column({ name: 'symptom_onset', type: 'varchar', length: 100, nullable: true })
  symptomOnset?: string;

  @Column({ name: 'symptom_duration', type: 'varchar', length: 100, nullable: true })
  symptomDuration?: string;

  @Column({ name: 'symptom_severity', type: 'varchar', length: 50, nullable: true })
  symptomSeverity?: string;

  @Column({ name: 'patient_note', type: 'text', nullable: true })
  patientNote?: string;

  @Column({ name: 'requested_service_note', type: 'text', nullable: true })
  requestedServiceNote?: string;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt?: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt?: Date;

  @Column({ name: 'processed_by_id', type: 'uuid', nullable: true })
  processedById?: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'processed_by_id' })
  processedBy?: User;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string;

  @Column({ name: 'visit_id', type: 'uuid', nullable: true })
  visitId?: string;

  @OneToOne('Visit', (visit: any) => visit.receptionRequest, { nullable: true })
  @JoinColumn({ name: 'visit_id' })
  visit?: Visit;
}
