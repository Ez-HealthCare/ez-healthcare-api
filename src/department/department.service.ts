import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Department } from './entities/department.entity';
import { TriageRule } from '../triage/entities/triage-rule.entity';

@Injectable()
export class DepartmentService {
  constructor(
    @InjectRepository(Department)
    private readonly departmentRepository: Repository<Department>,
    @InjectRepository(TriageRule)
    private readonly ruleRepository: Repository<TriageRule>,
  ) {}

  async findAll() {
    return this.departmentRepository.find({
      where: { isActive: true },
      order: { floor: 'ASC', code: 'ASC' },
    });
  }

  async findByCode(code: string) {
    const dept = await this.departmentRepository.findOne({ where: { code } });
    if (!dept) {
      throw new NotFoundException(`Department with code ${code} not found`);
    }
    return dept;
  }

  async getTriageRules() {
    return this.ruleRepository.find({
      relations: { targetDepartment: true },
      order: { priorityWeight: 'DESC' },
    });
  }
}
