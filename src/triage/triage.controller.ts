import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TriageRule } from './entities/triage-rule.entity';
import { Department } from '../department/entities/department.entity';
import { RecommendTriageDto } from './dto/recommend-triage.dto';

@ApiTags('Clinical Triage & Routing Engine')
@Controller('triage')
export class TriageController {
  constructor(
    @InjectRepository(TriageRule)
    private readonly ruleRepository: Repository<TriageRule>,
    @InjectRepository(Department)
    private readonly departmentRepository: Repository<Department>,
  ) {}

  @Get('rules')
  @ApiOperation({ summary: 'List all configured clinical triage rules with priority weights' })
  @ApiResponse({ status: 200, description: 'Triage rules returned successfully' })
  async getRules() {
    return this.ruleRepository.find({
      relations: { targetDepartment: true },
      order: { priorityWeight: 'DESC' },
    });
  }

  @Post('recommend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Evaluate symptoms and recommend appropriate clinical department' })
  @ApiResponse({ status: 200, description: 'Triage recommendation calculated successfully' })
  async recommend(@Body() dto: RecommendTriageDto) {
    const rules = await this.ruleRepository.find({
      relations: { targetDepartment: true },
      order: { priorityWeight: 'DESC' },
    });

    const symptoms = dto.symptoms || [];

    // 1. Red Flag check
    for (const rule of rules) {
      if (rule.isRedFlag && symptoms.includes(rule.symptomCode)) {
        return {
          isRedFlag: true,
          recommendedDepartment: rule.targetDepartment,
          matchedRule: rule,
          urgencyLevel: 'STAT_EMERGENCY',
          message:
            'CRITICAL ALERT: Patient displays high-risk symptoms requiring immediate emergency care.',
        };
      }
    }

    // 2. Standard rule matching by highest priority weight
    for (const rule of rules) {
      if (symptoms.includes(rule.symptomCode)) {
        return {
          isRedFlag: false,
          recommendedDepartment: rule.targetDepartment,
          matchedRule: rule,
          urgencyLevel: 'ROUTINE',
          isElderlyPriority: (dto.age ?? 0) >= 80,
          message: `Recommended clinic based on matched symptom: ${rule.symptomName}`,
        };
      }
    }

    // 3. Fallback: General Internal Medicine (P.102)
    const defaultClinic = await this.departmentRepository.findOne({ where: { code: 'P.102' } });
    return {
      isRedFlag: false,
      recommendedDepartment: defaultClinic,
      urgencyLevel: 'ROUTINE',
      isElderlyPriority: (dto.age ?? 0) >= 80,
      message: 'Default recommendation: General Internal Medicine Clinic',
    };
  }
}
