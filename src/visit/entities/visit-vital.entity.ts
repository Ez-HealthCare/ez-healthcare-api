import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../database/entities/user.entity';
import type { Visit } from './visit.entity';

@Entity('visit_vitals')
export class VisitVital extends BaseEntity {
  @Column({ name: 'visit_id', type: 'uuid' })
  @Index('idx_visit_vitals_visit_id')
  visitId: string;

  @OneToOne('Visit', (v: any) => v.vital)
  @JoinColumn({ name: 'visit_id' })
  visit: Visit;

  @Column({ name: 'nurse_id', type: 'uuid' })
  nurseId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'nurse_id' })
  nurse: User;

  @Column({ type: 'int' })
  bloodPressureSystolic: number;

  @Column({ type: 'int' })
  bloodPressureDiastolic: number;

  @Column({ type: 'int' })
  heartRate: number;

  @Column({ type: 'decimal', precision: 4, scale: 1 })
  temperature: number;

  @Column({ type: 'decimal', precision: 4, scale: 1 })
  spo2: number;

  @Column({ type: 'int' })
  respiratoryRate: number;

  @Column({ name: 'weight_kg', type: 'decimal', precision: 5, scale: 1, nullable: true })
  weightKg?: number;

  @Column({ name: 'height_cm', type: 'decimal', precision: 5, scale: 1, nullable: true })
  heightCm?: number;

  @Column({ name: 'news2_score', type: 'int', default: 0 })
  news2Score: number;

  @Column({ name: 'news2_risk', type: 'varchar', length: 20, default: 'LOW' })
  news2Risk: string;

  @Column({ type: 'boolean', default: false })
  isRedFlag: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  redFlagReason?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;
}
