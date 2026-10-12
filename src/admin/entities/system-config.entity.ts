import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../database/entities/base.entity';

@Entity('system_configs')
export class SystemConfig extends BaseEntity {
  @Column({ type: 'varchar', length: 100, unique: true })
  @Index('idx_system_configs_key')
  configKey: string;

  @Column({ type: 'text' })
  configValue: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'int', default: 1 })
  version: number;
}
