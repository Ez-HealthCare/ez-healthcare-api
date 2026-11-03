import { createHmac } from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { NotificationService } from '../notification/notification.service';
import { PatientHistoryQueryDto } from './dto/patient-history-query.dto';
import { DoctorHistoryQueryDto } from './dto/doctor-history-query.dto';
import { StepStatus } from './enums/step-status.enum';
import { AuditService } from '../common/audit.service';
import { DEPARTMENT_CODES, QUEUE_PRIORITY_DEFAULTS } from '../common/constants/clinical.constants';
import { DRUG_CLASS_MAP } from '../common/constants/visit.constants';
import { toVisitDossier } from '../common/dto/response.dto';
import { ApiConfigService } from '../config/api-config.service';
import { User } from '../database/entities/user.entity';
import { Department } from '../department/entities/department.entity';
import { DoctorSchedule } from '../department/entities/doctor-schedule.entity';
import { PrescriptionItem } from '../prescription/entities/prescription-item.entity';
import { Prescription } from '../prescription/entities/prescription.entity';
import { Role } from '../user/enums/role.enum';
import { getBusinessTime } from './business-time';
import { clinicalForbidden } from './clinical-error';
import { ConcludeVisitDto } from './dto/conclude-visit.dto';
import { EmergencyDispatchDto } from './dto/transfer-clinic.dto';
import { VisitStep } from './entities/visit-step.entity';
import { Visit } from './entities/visit.entity';
import { VisitStatus } from './enums/visit-status.enum';
import { assertTransition } from './visit-state-machine';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesDrug(label: string, drug: string): boolean {
  if (!label || !drug) return false;
  if (label === drug) return true;
  const escaped = escapeRegExp(drug);
  return new RegExp(`(?:^|[\\s\\-/.,;:()+])${escaped}s?(?:$|[\\s\\-/.,;:()+0-9])`, 'i').test(label);
}

export function checkAllergyConflict(
  medicationName: string,
  patientAllergies: string[],
): string | null {
  const medication = medicationName?.trim().toLowerCase();
  if (!medication || !patientAllergies?.length) return null;
  for (const allergy of patientAllergies) {
    const normalized = allergy?.trim().toLowerCase();
    if (!normalized) continue;
    if (
      medication === normalized ||
      matchesDrug(medication, normalized) ||
      matchesDrug(normalized, medication)
    ) {
      return allergy;
    }
    for (const [drugClass, drugs] of Object.entries(DRUG_CLASS_MAP)) {
      const allergyIsClass = matchesDrug(normalized, drugClass);
      const medicationIsClass = matchesDrug(medication, drugClass);
      const allergyIsMember = drugs.some((drug) => matchesDrug(normalized, drug));
      const medicationIsMember = drugs.some((drug) => matchesDrug(medication, drug));
      if (
        (allergyIsClass && medicationIsMember) ||
        (medicationIsClass && allergyIsMember) ||
        (allergyIsMember && medicationIsMember)
      ) {
        return allergy;
      }
    }
  }
  return null;
}

@Injectable()
export class VisitService {
  constructor(
    @InjectRepository(Visit)
    private readonly visits: Repository<Visit>,
    @InjectRepository(DoctorSchedule)
    private readonly schedules: Repository<DoctorSchedule>,
    @InjectRepository(Prescription)
    private readonly prescriptions: Repository<Prescription>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly config: ApiConfigService,
    private readonly notifications: NotificationService,
  ) {}

  private async assertDoctorAssignment(doctorId: string, departmentId?: string) {
    if (!departmentId) {
      throw clinicalForbidden('ROOM_ACCESS_DENIED', 'Visit is not assigned to a clinic room.');
    }
    const { businessDate, shiftType } = getBusinessTime(
      new Date(),
      this.config.queueIssuanceWindows,
    );
    if (!shiftType) throw clinicalForbidden('ROOM_ACCESS_DENIED', 'No active doctor shift.');
    const schedule = await this.schedules.findOne({
      where: { doctorId, departmentId, shiftDate: new Date(businessDate), shiftType },
    });
    if (!schedule) {
      throw clinicalForbidden('ROOM_ACCESS_DENIED', 'Doctor is not assigned to this clinic room.');
    }
  }

  async emergencyDispatch(
    id: string,
    dto: EmergencyDispatchDto,
    actor: { id: string; role: Role },
  ) {
    return this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const visit = await manager
        .getRepository(Visit)
        .createQueryBuilder('visit')
        .setLock('pessimistic_write')
        .where('visit.id = :id', { id })
        .getOne();
      if (!visit) throw new NotFoundException(`Visit with ID ${id} not found`);
      assertTransition(visit.status, VisitStatus.EMERGENCY_DISPATCHED);
      const emergency = await manager.getRepository(Department).findOne({
        where: { code: DEPARTMENT_CODES.EMERGENCY },
      });
      visit.status = VisitStatus.EMERGENCY_DISPATCHED;
      visit.isPriority = true;
      visit.priorityReason = `STAT EMERGENCY DISPATCH: ${dto.reason}`;
      visit.currentDepartmentId = emergency?.id;
      await manager.getRepository(Visit).save(visit);
      await this.audit.log(
        {
          action: 'EMERGENCY_DISPATCH',
          actorId: actor.id,
          actorRole: actor.role,
          targetEntityType: 'Visit',
          targetEntityId: id,
          metadata: {
            status: visit.status,
            destinationRoom: DEPARTMENT_CODES.EMERGENCY,
            reason: dto.reason,
          },
        },
        manager,
      );
      return {
        visitId: id,
        status: visit.status,
        reason: dto.reason,
        destinationRoom: DEPARTMENT_CODES.EMERGENCY,
        alert: '🚨 STAT EMERGENCY DISPATCH TRIGGERED!',
      };
    });
  }

  async getDoctorHistory(doctorId: string, query: DoctorHistoryQueryDto) {
    const builder = this.prescriptions
      .createQueryBuilder('prescription')
      .innerJoinAndSelect('prescription.visit', 'visit')
      .innerJoinAndSelect('visit.patient', 'patient')
      .leftJoinAndSelect('visit.currentDepartment', 'department')
      .select([
        'prescription.id',
        'prescription.visitId',
        'prescription.updatedAt',
        'prescription.icd10Code',
        'prescription.icd10Name',
        'visit.id',
        'visit.hallTicketNumber',
        'visit.clinicTicketNumber',
        'visit.status',
        'visit.createdAt',
        'patient.id',
        'patient.name',
        'department.id',
        'department.code',
        'department.name',
      ])
      .where('prescription.doctor_id = :doctorId', { doctorId })
      .andWhere('visit.status = :status', { status: VisitStatus.COMPLETED });
    if (query.completedDate) {
      const start = new Date(`${query.completedDate}T00:00:00+07:00`);
      const end = new Date(start.getTime() + 86_400_000);
      builder.andWhere('prescription.updated_at >= :start AND prescription.updated_at < :end', {
        start,
        end,
      });
    }
    if (query.search?.trim()) {
      const search = `%${query.search.trim().replace(/[!%_]/g, '!$&')}%`;
      builder.andWhere(
        "(patient.name ILIKE :search ESCAPE '!' OR visit.clinicTicketNumber ILIKE :search ESCAPE '!' OR visit.hallTicketNumber ILIKE :search ESCAPE '!')",
        { search },
      );
    }
    const [items, total] = await builder
      .orderBy('prescription.updatedAt', 'DESC')
      .addOrderBy('prescription.id', 'DESC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: items.map((item) => ({
        visitId: item.visitId,
        patientName: item.visit.patient.name,
        createdAt: item.visit.createdAt,
        completedAt: item.updatedAt,
        hallTicketNumber: item.visit.hallTicketNumber,
        clinicTicketNumber: item.visit.clinicTicketNumber,
        room: item.visit.currentDepartment
          ? { code: item.visit.currentDepartment.code, name: item.visit.currentDepartment.name }
          : null,
        icd10Code: item.icd10Code,
        icd10Name: item.icd10Name,
      })),
    };
  }

  async getDoctorHistoryDetail(id: string, doctorId: string) {
    const prescription = await this.prescriptions.findOne({
      where: { visitId: id, doctorId },
      relations: { items: true, doctor: true },
    });
    if (!prescription) throw new NotFoundException('Completed visit record not found.');
    const visit = await this.visits.findOne({
      where: { id, status: VisitStatus.COMPLETED },
      relations: {
        patient: true,
        currentDoctor: true,
        currentDepartment: true,
        vital: true,
        steps: { department: true },
      },
    });
    if (!visit) throw new NotFoundException('Completed visit record not found.');
    return toVisitDossier(visit, prescription, false);
  }

  async getPatientHistory(patientId: string, query: PatientHistoryQueryDto) {
    const [visits, total] = await this.visits.findAndCount({
      where: { patientId, ...(query.status ? { status: query.status } : {}) },
      relations: { currentDepartment: true, currentDoctor: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    const prescriptions = visits.length
      ? await this.prescriptions.find({
          where: { visitId: In(visits.map((visit) => visit.id)) },
        })
      : [];
    const byVisit = new Map(prescriptions.map((item) => [item.visitId, item]));
    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      items: visits.map((visit) => {
        const prescription = byVisit.get(visit.id);
        return {
          visitId: visit.id,
          createdAt: visit.createdAt,
          updatedAt: visit.updatedAt,
          hallTicketNumber: visit.hallTicketNumber,
          clinicTicketNumber: visit.clinicTicketNumber,
          status: visit.status,
          chiefComplaint: visit.chiefComplaint,
          room: visit.currentDepartment
            ? { code: visit.currentDepartment.code, name: visit.currentDepartment.name }
            : null,
          doctor: visit.currentDoctor
            ? { id: visit.currentDoctor.id, name: visit.currentDoctor.name }
            : null,
          conclusion: prescription
            ? {
                icd10Code: prescription.icd10Code,
                icd10Name: prescription.icd10Name,
                signedAt: prescription.updatedAt,
              }
            : null,
        };
      }),
    };
  }

  async concludeVisit(id: string, dto: ConcludeVisitDto, doctorId: string) {
    return this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const visit = await manager
        .getRepository(Visit)
        .createQueryBuilder('visit')
        .setLock('pessimistic_write')
        .where('visit.id = :id', { id })
        .getOne();
      if (!visit) throw new NotFoundException(`Visit with ID ${id} not found`);
      if (visit.status === VisitStatus.COMPLETED) {
        throw new ConflictException('Visit has already been concluded.');
      }
      if (visit.currentDoctorId !== doctorId) {
        throw new ForbiddenException('Only the doctor examining this visit may conclude it.');
      }
      assertTransition(visit.status, VisitStatus.COMPLETED);
      const patient = await manager.getRepository(User).findOneByOrFail({ id: visit.patientId });
      for (const item of dto.items ?? []) {
        const conflict = checkAllergyConflict(item.medicationName, patient.allergies ?? []);
        if (conflict) {
          throw new UnprocessableEntityException(
            `ALLERGY SAFETY WARNING: Patient has documented allergy to ${conflict}. Medication "${item.medicationName}" is contraindicated.`,
          );
        }
      }
      const signature = createHmac('sha256', this.config.signatureSecret)
        .update(
          JSON.stringify({
            doctorId,
            visitId: id,
            icd10Code: dto.icd10Code,
            timestamp: new Date().toISOString(),
          }),
        )
        .digest('hex');
      const prescriptionRepo = manager.getRepository(Prescription);
      const itemRepo = manager.getRepository(PrescriptionItem);
      let prescription = await prescriptionRepo.findOne({ where: { visitId: id } });
      prescription ??= prescriptionRepo.create({ visitId: id, doctorId });
      Object.assign(prescription, {
        doctorId,
        icd10Code: dto.icd10Code,
        icd10Name: dto.icd10Name,
        notes: dto.doctorNotes,
        revisitDate: dto.revisitDate ? new Date(dto.revisitDate) : undefined,
        digitalSignature: signature,
      });
      prescription = await prescriptionRepo.save(prescription);
      await itemRepo.delete({ prescriptionId: prescription.id });
      if (dto.items?.length) {
        await itemRepo.save(
          dto.items.map((item) =>
            itemRepo.create({
              prescriptionId: prescription.id,
              medicationName: item.medicationName,
              dosage: item.dosage,
              route: item.route || 'ORAL',
              frequency: item.frequency,
              durationDays: item.durationDays || 7,
              quantity: item.quantity || 1,
              instructions: item.instructions,
            }),
          ),
        );
      }
      visit.status = VisitStatus.COMPLETED;
      await manager.getRepository(Visit).save(visit);
      await manager
        .getRepository(VisitStep)
        .update({ visitId: id, isReExam: true }, { status: StepStatus.COMPLETED });
      await this.notifications.create(
        {
          userId: visit.patientId,
          visitId: id,
          type: 'VISIT_COMPLETED',
          title: 'Đã hoàn tất khám',
          message:
            'Bác sĩ đã lưu kết luận và đơn thuốc. Mở hồ sơ khám bệnh để xem lại lời dặn và lịch tái khám.',
        },
        manager,
      );
      await this.audit.log(
        {
          action: 'CONCLUDE_VISIT',
          actorId: doctorId,
          actorRole: Role.DOCTOR,
          targetEntityType: 'Visit',
          targetEntityId: id,
          metadata: {
            status: visit.status,
            prescriptionId: prescription.id,
            icd10Code: prescription.icd10Code,
          },
        },
        manager,
      );
      return {
        visitId: id,
        status: visit.status,
        prescriptionId: prescription.id,
        icd10Code: prescription.icd10Code,
        icd10Name: prescription.icd10Name,
        digitalSignature: prescription.digitalSignature,
      };
    });
  }

  async getRoute(id: string, callerId: string, callerRole: Role) {
    const visit = await this.visits.findOne({
      where: { id },
      relations: {
        initialDepartment: true,
        currentDepartment: true,
        steps: { department: true },
      },
    });
    if (!visit) throw new NotFoundException(`Visit with ID ${id} not found`);
    if (callerRole === Role.PATIENT && visit.patientId !== callerId) {
      throw new ForbiddenException('Patients may only access their own visit route.');
    }
    if (callerRole === Role.DOCTOR) {
      await this.assertDoctorAssignment(callerId, visit.currentDepartmentId);
    }
    const currentFloor = visit.currentDepartment?.floor || 1;
    const routeStations = [...(visit.steps ?? [])]
      .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
      .map((step: VisitStep) => {
        const department = step.department;
        const queueWait = department ? department.avgServiceTimeMin * 2 : 10;
        const floorDiff = department ? Math.abs(department.floor - currentFloor) : 0;
        return {
          stepId: step.id,
          sequenceOrder: step.sequenceOrder,
          status: step.status,
          departmentCode: department?.code,
          departmentName: department?.name,
          floor: department?.floor,
          roomType: department?.roomType,
          estimatedWaitMin: queueWait,
          heuristicCost: Number(
            (
              QUEUE_PRIORITY_DEFAULTS.alphaWaitWeight * queueWait +
              QUEUE_PRIORITY_DEFAULTS.betaDistanceWeight * floorDiff
            ).toFixed(2),
          ),
          isReExam: step.isReExam,
        };
      });
    return {
      visitId: id,
      clinicTicketNumber: visit.clinicTicketNumber,
      hallTicketNumber: visit.hallTicketNumber,
      currentStatus: visit.status,
      currentFloor,
      routeStations,
    };
  }

  async getVisitDetails(id: string, callerId: string, callerRole: Role, includePatientPii = false) {
    const visit = await this.visits.findOne({
      where: { id },
      relations: {
        patient: true,
        receptionist: true,
        currentDoctor: true,
        initialDepartment: true,
        currentDepartment: true,
        vital: true,
        order: true,
        steps: { department: true },
      },
    });
    if (!visit) throw new NotFoundException(`Visit with ID ${id} not found`);
    if (callerRole === Role.PATIENT && visit.patientId !== callerId) {
      throw new ForbiddenException('Patients may only access their own visit records.');
    }
    if (callerRole === Role.DOCTOR) {
      await this.assertDoctorAssignment(callerId, visit.currentDepartmentId);
    }
    const prescription = await this.prescriptions.findOne({
      where: { visitId: id },
      relations: { items: true, doctor: true },
    });
    return toVisitDossier(visit, prescription, includePatientPii);
  }

  async evaluateParaclinicalCompletion(visitId: string, remainingPendingSteps: number) {
    const visit = await this.visits.findOne({ where: { id: visitId } });
    if (!visit) throw new NotFoundException('Visit not found');
    if (remainingPendingSteps === 0 && visit.status === VisitStatus.PARACLINICAL_PENDING) {
      visit.status = VisitStatus.RE_EXAM_CALLING;
      visit.isPriority = true;
      visit.priorityReason = 'Priority Recall: All diagnostic results completed';
    }
    return this.visits.save(visit);
  }
}
