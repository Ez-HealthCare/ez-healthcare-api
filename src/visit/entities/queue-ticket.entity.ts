import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../database/entities/user.entity';
import type { Visit } from './visit.entity';
import { QueueTicketKind, QueueTicketStatus } from '../enums/queue-ticket.enum';

@Entity('queue_tickets')
@Index('uq_queue_ticket_sequence', ['kind', 'scopeKey', 'businessDate', 'sequence'], {
  unique: true,
})
@Index('uq_queue_ticket_idempotency', ['idempotencyKey'], { unique: true })
@Index('idx_queue_ticket_visit_kind', ['visitId', 'kind'])
@Index('uq_queue_ticket_current_visit_kind', ['visitId', 'kind'], {
  unique: true,
  where: `"status" IN ('ACTIVE', 'PAUSED')`,
})
@Index('idx_queue_ticket_active_queue', ['businessDate', 'kind', 'scopeKey', 'status', 'queuedAt'])
export class QueueTicket extends BaseEntity {
  @Column({ name: 'visit_id', type: 'uuid' })
  visitId: string;

  @ManyToOne('Visit')
  @JoinColumn({ name: 'visit_id' })
  visit: Visit;

  @Column({ type: 'enum', enum: QueueTicketKind })
  kind: QueueTicketKind;

  @Column({ name: 'scope_key', type: 'varchar', length: 100 })
  scopeKey: string;

  @Column({ name: 'business_date', type: 'date' })
  businessDate: string;

  @Column({ type: 'int' })
  sequence: number;

  @Column({ name: 'display_number', type: 'varchar', length: 30 })
  displayNumber: string;

  @Column({ type: 'enum', enum: QueueTicketStatus, default: QueueTicketStatus.ACTIVE })
  status: QueueTicketStatus;

  @Column({ name: 'issued_by_id', type: 'uuid', nullable: true })
  issuedById?: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'issued_by_id' })
  issuedBy?: User;

  @Column({ name: 'reissue_of_id', type: 'uuid', nullable: true })
  reissueOfId?: string;

  @Column({ name: 'reissue_reason', type: 'text', nullable: true })
  reissueReason?: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 100 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  operation?: string;

  @Column({ name: 'request_fingerprint', type: 'char', length: 64, nullable: true })
  requestFingerprint?: string;

  @Column({ name: 'queued_at', type: 'timestamptz' })
  queuedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'call_attempts', type: 'int', default: 0 })
  callAttempts: number;

  @Column({ name: 'last_called_at', type: 'timestamptz', nullable: true })
  lastCalledAt?: Date;
}
