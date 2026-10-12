import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Role } from '../../user/enums/role.enum';

@Entity('users')
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 255, unique: true })
  @Index('idx_users_email')
  email: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  password?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string;

  @Column({
    type: 'enum',
    enum: Role,
    default: Role.PATIENT,
  })
  role: Role;

  @Column({ type: 'varchar', length: 20, unique: true, nullable: true })
  @Index('idx_users_national_id')
  nationalId?: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  insuranceCardNumber?: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  gender?: string;

  @Column({ type: 'date', nullable: true })
  dateOfBirth?: Date;

  @Column({ type: 'text', array: true, nullable: true })
  allergies?: string[];

  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}
