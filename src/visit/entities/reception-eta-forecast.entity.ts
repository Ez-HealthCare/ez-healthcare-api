import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { QueueTicket } from './queue-ticket.entity';

@Entity('reception_eta_forecasts')
export class ReceptionEtaForecast {
  @PrimaryColumn({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @ManyToOne(() => QueueTicket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket: QueueTicket;

  @PrimaryColumn({ name: 'queued_at', type: 'timestamptz' })
  queuedAt: Date;

  @PrimaryColumn({ type: 'int' })
  version: number;

  @Column({ name: 'calculated_at', type: 'timestamptz' })
  calculatedAt: Date;

  @Column({ name: 'estimated_start_at', type: 'timestamptz', nullable: true })
  estimatedStartAt: Date | null;

  @Column({ name: 'actual_started_at', type: 'timestamptz', nullable: true })
  actualStartedAt: Date | null;
}
