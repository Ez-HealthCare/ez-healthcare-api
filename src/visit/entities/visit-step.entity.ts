import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../database/entities/base.entity';
import { Department } from '../../department/entities/department.entity';
import { StepStatus } from '../enums/step-status.enum';
import type { Visit } from './visit.entity';
import type { VisitOrder } from './visit-order.entity';

@Entity('visit_steps')
export class VisitStep extends BaseEntity {
  @Column({ name: 'visit_id', type: 'uuid' })
  @Index('idx_visit_steps_visit_id')
  visitId: string;

  @ManyToOne('Visit', (v: any) => v.steps)
  @JoinColumn({ name: 'visit_id' })
  visit: Visit;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string;

  @ManyToOne('VisitOrder', { nullable: true })
  @JoinColumn({ name: 'order_id' })
  order?: VisitOrder;

  @Column({ name: 'department_id', type: 'uuid' })
  departmentId: string;

  @ManyToOne(() => Department)
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @Column({ type: 'int', default: 1 })
  sequenceOrder: number;

  @Column({ name: 'prerequisite_step_id', type: 'uuid', nullable: true })
  prerequisiteStepId?: string;

  @ManyToOne('VisitStep', { nullable: true })
  @JoinColumn({ name: 'prerequisite_step_id' })
  prerequisiteStep?: VisitStep;

  @Column({
    type: 'enum',
    enum: StepStatus,
    default: StepStatus.PENDING,
  })
  status: StepStatus;

  @Column({ type: 'boolean', default: false })
  isReExam: boolean;
}
