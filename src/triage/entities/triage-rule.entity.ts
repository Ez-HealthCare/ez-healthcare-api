import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../database/entities/base.entity';
import { Department } from '../../department/entities/department.entity';

@Entity('triage_rules')
export class TriageRule extends BaseEntity {
  @Column({ type: 'varchar', length: 50, unique: true })
  @Index('idx_triage_rules_symptom_code')
  symptomCode: string;

  @Column({ type: 'varchar', length: 255 })
  symptomName: string;

  @Column({ name: 'target_department_id', type: 'uuid' })
  targetDepartmentId: string;

  @ManyToOne(() => Department)
  @JoinColumn({ name: 'target_department_id' })
  targetDepartment: Department;

  @Column({ type: 'boolean', default: false })
  isRedFlag: boolean;

  @Column({ type: 'text', array: true, nullable: true })
  contraindicationTags?: string[];

  @Column({ type: 'int', default: 1 })
  priorityWeight: number;
}
