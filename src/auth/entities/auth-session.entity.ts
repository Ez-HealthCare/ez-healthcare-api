import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../database/entities/base.entity';

@Entity('auth_sessions')
export class AuthSession extends BaseEntity {
  @Column({ type: 'uuid' })
  @Index('idx_auth_sessions_user')
  userId: string;

  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'boolean', default: false })
  rememberMe: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
}
