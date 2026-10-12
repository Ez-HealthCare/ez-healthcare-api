import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../database/entities/base.entity';
import { RoomType } from '../enums/room-type.enum';

@Entity('departments')
export class Department extends BaseEntity {
  @Column({ type: 'varchar', length: 50, unique: true })
  @Index('idx_departments_code')
  code: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({
    type: 'enum',
    enum: RoomType,
    default: RoomType.CONSULTATION,
  })
  roomType: RoomType;

  @Column({ type: 'int', default: 1 })
  floor: number;

  @Column({ type: 'int', default: 15 })
  avgServiceTimeMin: number;

  @Column({ type: 'int', default: 40 })
  maxQuotaPerSlot: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}
