import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../database/entities/base.entity';
import type { Prescription } from './prescription.entity';

@Entity('prescription_items')
export class PrescriptionItem extends BaseEntity {
  @Column({ name: 'prescription_id', type: 'uuid' })
  @Index('idx_prescription_items_prescription_id')
  prescriptionId: string;

  @ManyToOne('Prescription', (p: any) => p.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'prescription_id' })
  prescription: Prescription;

  @Column({ type: 'varchar', length: 255 })
  medicationName: string;

  @Column({ type: 'varchar', length: 100 })
  dosage: string;

  @Column({ type: 'varchar', length: 50, default: 'ORAL' })
  route: string;

  @Column({ type: 'varchar', length: 100 })
  frequency: string;

  @Column({ type: 'int', default: 7 })
  durationDays: number;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ type: 'text', nullable: true })
  instructions?: string;
}
