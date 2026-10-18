import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../database/entities/base.entity';

@Entity('patient_otps')
export class PatientOtp extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  @Index('idx_patient_otps_email')
  email: string;

  @Column({ type: 'varchar', length: 64 })
  otpCode: string;

  @Column({ type: 'timestamp with time zone' })
  expiresAt: Date;

  @Column({ type: 'int', default: 0 })
  failedAttempts: number;

  @Column({ type: 'boolean', default: false })
  isUsed: boolean;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lockedUntil?: Date | null;
}
