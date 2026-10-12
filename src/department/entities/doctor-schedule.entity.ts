import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../database/entities/user.entity';
import { Department } from './department.entity';

import { ShiftType } from '../enums/shift-type.enum';

@Entity('doctor_schedules')
@Index('idx_doctor_schedule_unique', ['doctorId', 'shiftDate', 'shiftType'], { unique: true })
export class DoctorSchedule extends BaseEntity {
  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'doctor_id' })
  doctor: User;

  @Column({ name: 'department_id', type: 'uuid' })
  departmentId: string;

  @ManyToOne(() => Department)
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @Column({ type: 'date' })
  shiftDate: Date;

  @Column({
    type: 'enum',
    enum: ShiftType,
    default: ShiftType.MORNING,
  })
  shiftType: ShiftType;

  @Column({ type: 'int', default: 15 })
  slotDurationMin: number;

  @Column({ type: 'int', default: 40 })
  maxQuota: number;

  @Column({ type: 'int', default: 0 })
  allocatedCount: number;
}
