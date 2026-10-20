import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../database/entities/base.entity';
import { QueueTicketKind } from '../enums/queue-ticket.enum';

@Entity('queue_counters')
@Index('uq_queue_counter_scope_day', ['kind', 'scopeKey', 'businessDate'], { unique: true })
export class QueueCounter extends BaseEntity {
  @Column({ type: 'enum', enum: QueueTicketKind })
  kind: QueueTicketKind;

  @Column({ name: 'scope_key', type: 'varchar', length: 100 })
  scopeKey: string;

  @Column({ name: 'business_date', type: 'date' })
  businessDate: string;

  @Column({ name: 'last_issued', type: 'int', default: 0 })
  lastIssued: number;
}
