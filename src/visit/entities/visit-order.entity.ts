import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../database/entities/user.entity';
import type { Visit } from './visit.entity';

@Entity('visit_orders')
export class VisitOrder extends BaseEntity {
  @Column({ name: 'visit_id', type: 'uuid' })
  @Index('idx_visit_orders_visit_id')
  visitId: string;

  @OneToOne('Visit', (v: any) => v.order)
  @JoinColumn({ name: 'visit_id' })
  visit: Visit;

  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'doctor_id' })
  doctor: User;

  @Column({ type: 'text', nullable: true })
  workingDiagnosis?: string;

  @Column({ type: 'boolean', default: false })
  isStat: boolean;

  @Column({ type: 'boolean', default: false })
  pregnancySuspected: boolean;

  @Column({ type: 'text', nullable: true })
  doctorNotes?: string;
}
