import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../database/entities/user.entity';
import { Visit } from '../../visit/entities/visit.entity';
import type { PrescriptionItem } from './prescription-item.entity';

@Entity('prescriptions')
export class Prescription extends BaseEntity {
  @Column({ name: 'visit_id', type: 'uuid' })
  @Index('idx_prescriptions_visit_id')
  visitId: string;

  @OneToOne(() => Visit)
  @JoinColumn({ name: 'visit_id' })
  visit: Visit;

  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'doctor_id' })
  doctor: User;

  @Column({ type: 'varchar', length: 20 })
  icd10Code: string;

  @Column({ type: 'varchar', length: 255 })
  icd10Name: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ type: 'date', nullable: true })
  revisitDate?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  digitalSignature?: string;

  @OneToMany('PrescriptionItem', (item: any) => item.prescription, { cascade: true })
  items: PrescriptionItem[];
}
