import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../database/entities/user.entity';
import { VisitStep } from '../../visit/entities/visit-step.entity';

@Entity('paraclinical_results')
export class ParaclinicalResult extends BaseEntity {
  @Column({ name: 'step_id', type: 'uuid' })
  @Index('idx_paraclinical_step_id')
  stepId: string;

  @OneToOne(() => VisitStep)
  @JoinColumn({ name: 'step_id' })
  step: VisitStep;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'technician_id' })
  technician: User;

  @Column({ type: 'varchar', length: 255 })
  serviceName: string;

  @Column({ type: 'text', nullable: true })
  resultSummary?: string;

  @Column({ type: 'jsonb', nullable: true })
  quantitativeValues?: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  findings?: string;

  @Column({ type: 'text', array: true, nullable: true })
  dicomImageUrls?: string[];

  @Column({ type: 'boolean', default: false })
  isPanicValue: boolean;

  @Column({ type: 'text', nullable: true })
  panicAlertDetails?: string;

  @Column({ type: 'timestamp with time zone', nullable: true })
  approvedAt?: Date;
}
