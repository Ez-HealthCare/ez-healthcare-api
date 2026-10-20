import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../database/entities/base.entity';
import { User } from '../database/entities/user.entity';
import type { Visit } from '../visit/entities/visit.entity';

@Entity('notifications')
@Index('idx_notification_user_created', ['userId', 'createdAt'])
export class Notification extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'visit_id', type: 'uuid', nullable: true })
  visitId?: string;

  @ManyToOne('Visit', { nullable: true })
  @JoinColumn({ name: 'visit_id' })
  visit?: Visit;

  @Column({ type: 'varchar', length: 50 })
  type: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt?: Date;
}
