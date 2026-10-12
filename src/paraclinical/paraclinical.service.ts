import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { ParaclinicalResult } from './entities/paraclinical-result.entity';
import { VisitStep } from '../visit/entities/visit-step.entity';
import { Visit } from '../visit/entities/visit.entity';
import { Department } from '../department/entities/department.entity';
import { StepStatus } from '../visit/enums/step-status.enum';
import { VisitStatus } from '../visit/enums/visit-status.enum';
import { SubmitResultDto } from './dto/submit-result.dto';

@Injectable()
export class ParaclinicalService {
  constructor(
    @InjectRepository(ParaclinicalResult)
    private readonly resultRepository: Repository<ParaclinicalResult>,
    @InjectRepository(VisitStep)
    private readonly stepRepository: Repository<VisitStep>,
    @InjectRepository(Visit)
    private readonly visitRepository: Repository<Visit>,
    @InjectRepository(Department)
    private readonly departmentRepository: Repository<Department>,
  ) {}

  async getWorklist(departmentCode?: string) {
    const query = this.stepRepository
      .createQueryBuilder('step')
      .leftJoinAndSelect('step.visit', 'visit')
      .leftJoinAndSelect('visit.patient', 'patient')
      .leftJoinAndSelect('step.department', 'dept')
      .where('step.isReExam = false')
      .andWhere('step.status IN (:...statuses)', {
        statuses: [StepStatus.WAITING, StepStatus.IN_PROGRESS, StepStatus.PENDING],
      });

    if (departmentCode) {
      query.andWhere('dept.code = :departmentCode', { departmentCode });
    }

    const steps = await query.orderBy('step.created_at', 'ASC').getMany();

    return steps.map((s) => ({
      stepId: s.id,
      sequenceOrder: s.sequenceOrder,
      status: s.status,
      departmentCode: s.department?.code,
      departmentName: s.department?.name,
      roomType: s.department?.roomType,
      floor: s.department?.floor,
      visitId: s.visitId,
      hallTicketNumber: s.visit?.hallTicketNumber,
      clinicTicketNumber: s.visit?.clinicTicketNumber,
      patientName: s.visit?.patient?.name,
      // nationalId intentionally omitted — worklist is visible to LAB_TECHNICIAN role
      // who do not need PII to fulfill the diagnostic order
    }));
  }

  async submitResult(stepId: string, dto: SubmitResultDto, technicianId: string) {
    const step = await this.stepRepository.findOne({
      where: { id: stepId },
      relations: { department: true, visit: true },
    });

    if (!step) {
      throw new NotFoundException('Paraclinical order step not found');
    }

    let result = await this.resultRepository.findOne({ where: { stepId } });
    if (!result) {
      result = this.resultRepository.create({
        stepId,
        technicianId,
        serviceName: step.department?.name || 'Diagnostic Service',
      });
    }

    result.technicianId = technicianId;
    result.quantitativeValues = dto.quantitativeValues;
    result.findings = dto.findings;
    result.isPanicValue = !!dto.isPanicValue;
    result.panicAlertDetails = dto.panicAlertDetails;
    result.dicomImageUrls = dto.dicomImageUrls;
    result.approvedAt = new Date();

    const savedResult = await this.resultRepository.save(result);

    // Update step status to COMPLETED
    step.status = StepStatus.COMPLETED;
    await this.stepRepository.save(step);

    // Evaluate remaining pending paraclinical steps for this visit
    const remainingSteps = await this.stepRepository.count({
      where: {
        visitId: step.visitId,
        isReExam: false,
        status: Not(StepStatus.COMPLETED),
      },
    });

    let autoRecallTriggered = false;
    if (remainingSteps === 0 && step.visit) {
      const visit = await this.visitRepository.findOne({ where: { id: step.visitId } });
      if (visit) {
        visit.status = VisitStatus.RE_EXAM_CALLING;
        visit.isPriority = true;
        visit.priorityReason = 'Priority Recall: All diagnostic results completed';
        await this.visitRepository.save(visit);
        autoRecallTriggered = true;
      }
    }

    return {
      resultId: savedResult.id,
      stepId: step.id,
      stepStatus: step.status,
      isPanicValue: savedResult.isPanicValue,
      panicAlertDetails: savedResult.panicAlertDetails,
      remainingDiagnosticSteps: remainingSteps,
      autoRecallTriggered,
      message: autoRecallTriggered
        ? 'Diagnostic result recorded. All tests completed! Patient automatically recalled to primary clinic.'
        : 'Diagnostic result recorded successfully.',
    };
  }

  async getResult(stepId: string) {
    const result = await this.resultRepository.findOne({
      where: { stepId },
      relations: { step: true, technician: true },
    });

    if (!result) {
      throw new NotFoundException(`Result for step ${stepId} not found`);
    }

    // Map to safe fields — never return raw entity
    return {
      resultId: result.id,
      stepId: result.stepId,
      serviceName: result.serviceName,
      quantitativeValues: result.quantitativeValues,
      findings: result.findings,
      isPanicValue: result.isPanicValue,
      panicAlertDetails: result.panicAlertDetails,
      dicomImageUrls: result.dicomImageUrls,
      approvedAt: result.approvedAt,
      stepStatus: result.step?.status,
      technician: result.technician
        ? { id: result.technician.id, name: result.technician.name }
        : undefined,
    };
  }
}
