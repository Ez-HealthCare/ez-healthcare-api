import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../database/entities/user.entity';
import { ShiftType } from '../../department/enums/shift-type.enum';

@Entity('reception_desk_shifts')
@Index('uq_reception_desk_shift', ['businessDate', 'shiftType', 'deskCode'], { unique: true })
@Index('uq_reception_staff_shift', ['businessDate', 'shiftType', 'receptionistId'], {
  unique: true,
})
export class ReceptionDeskShift extends BaseEntity {
  @Column({ name: 'business_date', type: 'date' })
  businessDate: string;

  @Column({ name: 'shift_type', type: 'varchar', length: 16 })
  shiftType: ShiftType;

  @Column({ name: 'desk_code', type: 'varchar', length: 2 })
  deskCode: string;

  @Column({ name: 'receptionist_id', type: 'uuid' })
  receptionistId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'receptionist_id' })
  receptionist: User;

  @Column({ name: 'accepting_calls', type: 'boolean', default: true })
  acceptingCalls: boolean;
}
