import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Visit } from '../visit/entities/visit.entity';
import { VisitOrder } from '../visit/entities/visit-order.entity';
import { VisitStep } from '../visit/entities/visit-step.entity';
import { Department } from '../department/entities/department.entity';
import { TriageRule } from './entities/triage-rule.entity';
import { StepStatus } from '../visit/enums/step-status.enum';
import { VisitStatus } from '../visit/enums/visit-status.enum';
import { assertTransition } from '../visit/visit-state-machine';

export interface DagEdge {
  from: string;
  to: string;
  type: string;
  reason: string;
}

export function runKahnAlgorithm(
  vertices: string[],
  edges: DagEdge[],
): { isAcyclic: boolean; sortedOrder?: string[]; error?: string } {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  vertices.forEach((v) => {
    inDegree.set(v, 0);
    adjacency.set(v, []);
  });

  edges.forEach((e) => {
    if (inDegree.has(e.to)) {
      inDegree.set(e.to, inDegree.get(e.to)! + 1);
    }
    if (adjacency.has(e.from)) {
      adjacency.get(e.from)!.push(e.to);
    }
  });

  const queue: string[] = [];
  inDegree.forEach((degree, vertex) => {
    if (degree === 0) queue.push(vertex);
  });

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    const neighbors = adjacency.get(current) || [];
    for (const neighbor of neighbors) {
      inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
      if (inDegree.get(neighbor) === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (sorted.length !== vertices.length) {
    return {
      isAcyclic: false,
      error:
        'Cyclic dependency detected in clinical orders. Order graph must be directed and acyclic.',
    };
  }

  return {
    isAcyclic: true,
    sortedOrder: sorted,
  };
}

@Injectable()
export class TriageDagService {
  constructor(
    @InjectRepository(Visit)
    private readonly visitRepository: Repository<Visit>,
    @InjectRepository(VisitOrder)
    private readonly orderRepository: Repository<VisitOrder>,
    @InjectRepository(VisitStep)
    private readonly stepRepository: Repository<VisitStep>,
    @InjectRepository(Department)
    private readonly departmentRepository: Repository<Department>,
    @InjectRepository(TriageRule)
    private readonly ruleRepository: Repository<TriageRule>,
  ) {}

  async processClinicalOrders(
    visitId: string,
    doctorId: string,
    dto: {
      orders: string[];
      workingDiagnosis?: string;
      pregnancySuspected?: boolean;
      symptoms?: string[];
      doctorNotes?: string;
    },
  ) {
    const visit = await this.visitRepository.findOne({
      where: { id: visitId },
      relations: { initialDepartment: true, vital: true },
    });

    if (!visit) {
      throw new NotFoundException(`Visit with ID ${visitId} not found`);
    }

    if (!visit.vital) {
      throw new BadRequestException(
        'Mandatory vital signs must be recorded before clinical orders can be submitted.',
      );
    }

    // 1. STAT Emergency Protocol Intercept
    const redFlagRules = await this.ruleRepository.find({ where: { isRedFlag: true } });
    const redFlagCodes = new Set(redFlagRules.map((r) => r.symptomCode));
    const isStat = (dto.symptoms || []).some((s) => redFlagCodes.has(s));

    const targetStatus = isStat
      ? VisitStatus.EMERGENCY_DISPATCHED
      : VisitStatus.PARACLINICAL_PENDING;
    assertTransition(visit.status, targetStatus);

    if (isStat) {
      const emergencyDept = await this.departmentRepository.findOne({ where: { code: 'P.001' } });
      visit.status = VisitStatus.EMERGENCY_DISPATCHED;
      visit.currentDepartmentId = emergencyDept ? emergencyDept.id : visit.initialDepartmentId;
      await this.visitRepository.save(visit);

      let order = await this.orderRepository.findOne({ where: { visitId } });
      if (!order) {
        order = this.orderRepository.create({
          visitId,
          doctorId,
          workingDiagnosis: dto.workingDiagnosis,
          isStat: true,
          pregnancySuspected: !!dto.pregnancySuspected,
          doctorNotes: dto.doctorNotes,
        });
      } else {
        order.isStat = true;
      }
      await this.orderRepository.save(order);

      return {
        isStatEmergency: true,
        destinationRoom: 'P.001',
        alert: '🚨 STAT EMERGENCY PROTOCOL ACTIVATED: Immediate transfer to P.001 Emergency Unit!',
      };
    }

    // 2. Radiation Hazard Intercept
    if (dto.pregnancySuspected && dto.orders.includes('P.302')) {
      throw new UnprocessableEntityException(
        'RADIATION HAZARD: Chest X-Ray P.302 is contraindicated for pregnant patients. Please substitute with Ultrasound or MRI.',
      );
    }

    // 3. Graph Vertices & Directed Edges
    const clinicCode = visit.initialDepartment ? visit.initialDepartment.code : 'P.102';
    const cleanOrders = Array.from(new Set(dto.orders.filter((c) => c !== clinicCode)));
    const vertices = [...cleanOrders, clinicCode];
    const edges: DagEdge[] = [];

    // All orders must conclude back at primary clinic
    for (const o of cleanOrders) {
      edges.push({
        from: o,
        to: clinicCode,
        type: 'CONCLUSION_DEPENDENCY',
        reason: 'Diagnostic test must conclude at primary consultation clinic',
      });
    }

    // Physiological prerequisite: Abdominal Ultrasound P.104 before Urinalysis P.203
    if (cleanOrders.includes('P.104') && cleanOrders.includes('P.203')) {
      edges.push({
        from: 'P.104',
        to: 'P.203',
        type: 'PHYSIOLOGICAL_PREREQUISITE',
        reason: 'Abdominal ultrasound requires full bladder prior to urinalysis voiding',
      });
    }

    // 4. Cycle Validation
    const validation = runKahnAlgorithm(vertices, edges);
    if (!validation.isAcyclic) {
      throw new BadRequestException(validation.error);
    }

    // 5. Persist Order & Steps
    let order = await this.orderRepository.findOne({ where: { visitId } });
    if (!order) {
      order = this.orderRepository.create({
        visitId,
        doctorId,
        workingDiagnosis: dto.workingDiagnosis,
        isStat: false,
        pregnancySuspected: !!dto.pregnancySuspected,
        doctorNotes: dto.doctorNotes,
      });
    } else {
      order.workingDiagnosis = dto.workingDiagnosis;
      order.isStat = false;
      order.doctorNotes = dto.doctorNotes;
    }
    const savedOrder = await this.orderRepository.save(order);

    // Fetch all departments in vertices
    const depts = await this.departmentRepository.find();
    const deptMap = new Map(depts.map((d) => [d.code, d]));

    // Remove old steps for idempotency
    await this.stepRepository.delete({ visitId });

    const sortedOrder = validation.sortedOrder || vertices;
    const savedStepsMap = new Map<string, VisitStep>();

    for (let i = 0; i < sortedOrder.length; i++) {
      const code = sortedOrder[i];
      const dept = deptMap.get(code);
      if (!dept) continue;

      const step = this.stepRepository.create({
        visitId,
        orderId: savedOrder.id,
        departmentId: dept.id,
        sequenceOrder: i + 1,
        status: i === 0 ? StepStatus.WAITING : StepStatus.PENDING,
        isReExam: code === clinicCode,
      });
      const savedStep = await this.stepRepository.save(step);
      savedStepsMap.set(code, savedStep);
    }

    // Link prerequisites
    for (const edge of edges) {
      const targetStep = savedStepsMap.get(edge.to);
      const sourceStep = savedStepsMap.get(edge.from);
      if (targetStep && sourceStep && !targetStep.prerequisiteStepId) {
        targetStep.prerequisiteStepId = sourceStep.id;
        await this.stepRepository.save(targetStep);
      }
    }

    visit.status = VisitStatus.PARACLINICAL_PENDING;
    visit.currentDoctorId = doctorId;
    await this.visitRepository.save(visit);

    return {
      isStatEmergency: false,
      isAcyclic: true,
      sortedOrder,
      edges,
      stepsCount: sortedOrder.length,
    };
  }
}
