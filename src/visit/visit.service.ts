import { createHmac } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, EntityManager, In, Repository } from 'typeorm';
import { Visit } from './entities/visit.entity';
import { VisitVital } from './entities/visit-vital.entity';
import { VisitOrder } from './entities/visit-order.entity';
import { VisitStep } from './entities/visit-step.entity';
import { Department } from '../department/entities/department.entity';
import { User } from '../database/entities/user.entity';
import { Prescription } from '../prescription/entities/prescription.entity';
import { PrescriptionItem } from '../prescription/entities/prescription-item.entity';
import { VisitStatus } from './enums/visit-status.enum';
import { assertTransition } from './visit-state-machine';
import { calculateNews2 } from './news2-calculator';
import { Role } from '../user/enums/role.enum';
import { CreateHallTicketDto } from './dto/create-hall-ticket.dto';
import { VerifyVisitDto, RejectVerificationDto } from './dto/verify-visit.dto';
import { AssignClinicDto } from './dto/assign-clinic.dto';
import { RecordVitalsDto } from './dto/record-vitals.dto';
import { EmergencyDispatchDto, TransferClinicDto } from './dto/transfer-clinic.dto';
import { ConcludeVisitDto } from './dto/conclude-visit.dto';
import { toVisitDossier } from '../common/dto/response.dto';
import { AuditService } from '../common/audit.service';
import { ApiConfigService } from '../config/api-config.service';

import { DRUG_CLASS_MAP } from '../common/constants/visit.constants';
import {
  DEPARTMENT_CODES,
  ELDERLY_PRIORITY_AGE,
  VN_OFFSET_MS,
  QUEUE_PRIORITY_DEFAULTS,
} from '../common/constants/clinical.constants';

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesDrug(label: string, drug: string): boolean {
  if (!label || !drug) {
    return false;
  }
  if (label === drug) {
    return true;
  }
  const escaped = escapeRegExp(drug);
  const pattern = new RegExp(`(?:^|[\\s\\-/.,;:()+])${escaped}s?(?:$|[\\s\\-/.,;:()+0-9])`, 'i');
  return pattern.test(label);
}

export function checkAllergyConflict(
  medicationName: string,
  patientAllergies: string[],
): string | null {
  if (!medicationName || !patientAllergies || patientAllergies.length === 0) {
    return null;
  }

  const medLower = medicationName.trim().toLowerCase();
  if (!medLower) {
    return null;
  }

  for (const allergy of patientAllergies) {
    if (!allergy || typeof allergy !== 'string') continue;
    const allergyLower = allergy.trim().toLowerCase();
    if (!allergyLower) continue;

    // 1. Exact match check (or label starting with full drug name followed by boundary)
    if (
      medLower === allergyLower ||
      matchesDrug(medLower, allergyLower) ||
      matchesDrug(allergyLower, medLower)
    ) {
      return allergy;
    }

    // 2. Drug class match checks
    for (const [classKey, drugs] of Object.entries(DRUG_CLASS_MAP)) {
      const allergyIsClass = matchesDrug(allergyLower, classKey);
      const medIsClass = matchesDrug(medLower, classKey);
      const allergyInDrugs = drugs.some((drug) => matchesDrug(allergyLower, drug));
      const medInDrugs = drugs.some((drug) => matchesDrug(medLower, drug));

      // Class/member matching in both directions
      if ((allergyIsClass && medInDrugs) || (medIsClass && allergyInDrugs)) {
        return allergy;
      }

      // Same-class member protection
      if (allergyInDrugs && medInDrugs) {
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
    private readonly visitRepository: Repository<Visit>,
    @InjectRepository(VisitVital)
    private readonly vitalRepository: Repository<VisitVital>,
    @InjectRepository(VisitOrder)
    private readonly orderRepository: Repository<VisitOrder>,
    @InjectRepository(VisitStep)
    private readonly stepRepository: Repository<VisitStep>,
    @InjectRepository(Department)
    private readonly departmentRepository: Repository<Department>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Prescription)
    private readonly prescriptionRepository: Repository<Prescription>,
    @InjectRepository(PrescriptionItem)
    private readonly itemRepository: Repository<PrescriptionItem>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly config: ApiConfigService,
  ) {}

  private async resolveActorRole(
    actorId?: string | null,
    manager?: EntityManager,
  ): Promise<string | null> {
    if (!actorId) {
      return null;
    }
    const repo = manager ? manager.getRepository(User) : this.userRepository;
    const user = await repo.findOne({ where: { id: actorId }, select: { id: true, role: true } });
    return user?.role ?? null;
  }

  private getTodayBounds(): { start: Date; end: Date } {
    const nowUtc = Date.now();
    const vnNow = new Date(nowUtc + VN_OFFSET_MS);

    const year = vnNow.getUTCFullYear();
    const month = vnNow.getUTCMonth();
    const day = vnNow.getUTCDate();

    const start = new Date(Date.UTC(year, month, day) - VN_OFFSET_MS);
    const end = new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - VN_OFFSET_MS);

    return { start, end };
  }

  async createHallTicket(dto: CreateHallTicketDto, currentUser?: { id: string; role: Role }) {
    return await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const userRepo = manager.getRepository(User);
      const visitRepo = manager.getRepository(Visit);

      // 1. Identify or retrieve Patient
      let patient: User | null = null;
      if (dto.patientId) {
        patient = await userRepo.findOne({ where: { id: dto.patientId } });
      } else if (currentUser && currentUser.role === Role.PATIENT) {
        patient = await userRepo.findOne({ where: { id: currentUser.id } });
      } else if (dto.nationalId) {
        patient = await userRepo.findOne({ where: { nationalId: dto.nationalId } });
      }

      if (!patient) {
        // Auto-create registered patient if demographic details are provided
        patient = userRepo.create({
          email: `guest.${Date.now()}@ezhealthcare.local`,
          name: dto.name,
          role: Role.PATIENT,
          nationalId: dto.nationalId,
          insuranceCardNumber: dto.insuranceCardNumber,
          gender: dto.gender,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
          allergies: dto.allergies || [],
          isActive: true,
        });
        patient = await userRepo.save(patient);
      } else if (
        dto.allergies &&
        dto.allergies.length > 0 &&
        (!patient.allergies || patient.allergies.length === 0)
      ) {
        patient.allergies = dto.allergies;
        patient = await userRepo.save(patient);
      }

      // 2. Prevent duplicate active ticket in the same calendar day
      const { start, end } = this.getTodayBounds();
      const existing = await visitRepo.findOne({
        where: {
          patientId: patient.id,
          createdAt: Between(start, end),
          status: In([
            VisitStatus.HALL_WAITING,
            VisitStatus.RECEPTION_VERIFIED,
            VisitStatus.TRIAGE_PENDING,
            VisitStatus.CLINIC_WAITING,
            VisitStatus.IN_EXAMINATION,
            VisitStatus.PARACLINICAL_PENDING,
            VisitStatus.RE_EXAM_CALLING,
          ]),
        },
      });

      if (existing) {
        throw new ConflictException('Patient already has an active visit ticket for today.');
      }

      // 3. Generate sequential Hall Ticket Number (A-001, A-002, ...)
      const countToday = await visitRepo.count({
        where: { createdAt: Between(start, end) },
      });
      const ticketSeq = String(countToday + 1).padStart(3, '0');
      const hallTicketNumber = `A-${ticketSeq}`;

      // 4. Create and persist Visit
      const visit = visitRepo.create({
        patientId: patient.id,
        hallTicketNumber,
        status: VisitStatus.HALL_WAITING,
        chiefComplaint: dto.chiefComplaint,
        symptomOnset: dto.symptomOnset,
        symptomDuration: dto.symptomDuration,
        symptomSeverity: dto.symptomSeverity,
      });

      const saved = await visitRepo.save(visit);

      const actorId = currentUser?.id ?? null;
      const actorRole = currentUser?.role ?? (await this.resolveActorRole(actorId, manager));
      await this.auditService.log(
        {
          action: 'CREATE_HALL_TICKET',
          actorId,
          actorRole,
          targetEntityType: 'Visit',
          targetEntityId: saved.id,
          metadata: {
            hallTicketNumber: saved.hallTicketNumber,
            status: saved.status,
          },
        },
        manager,
      );

      return {
        visitId: saved.id,
        hallTicketNumber: saved.hallTicketNumber,
        status: saved.status,
        patient: {
          id: patient.id,
          name: patient.name,
          nationalId: patient.nationalId,
        },
      };
    });
  }

  async verifyVisit(id: string, dto: VerifyVisitDto, receptionistId?: string) {
    const visit = await this.visitRepository.findOne({
      where: { id },
      relations: { patient: true },
    });

    if (!visit) {
      throw new NotFoundException(`Visit with ID ${id} not found`);
    }

    const targetStatus = dto.nationalIdVerified
      ? VisitStatus.RECEPTION_VERIFIED
      : VisitStatus.CANCELLED;
    assertTransition(visit.status, targetStatus);

    if (!dto.nationalIdVerified) {
      visit.status = VisitStatus.CANCELLED;
      await this.visitRepository.save(visit);

      const actorId = receptionistId ?? null;
      const actorRole = await this.resolveActorRole(actorId);
      await this.auditService.log({
        action: 'VERIFY_VISIT',
        actorId,
        actorRole,
        targetEntityType: 'Visit',
        targetEntityId: visit.id,
        metadata: {
          status: visit.status,
          verified: false,
        },
      });

      return { status: visit.status, message: 'Identity verification failed. Visit cancelled.' };
    }

    visit.isVerified = true;
    visit.status = VisitStatus.RECEPTION_VERIFIED;
    if (receptionistId) visit.receptionistId = receptionistId;

    if (dto.insuranceCardNumber && visit.patient) {
      visit.patient.insuranceCardNumber = dto.insuranceCardNumber;
      await this.userRepository.save(visit.patient);
    }

    const saved = await this.visitRepository.save(visit);

    const actorId = receptionistId ?? null;
    const actorRole = await this.resolveActorRole(actorId);
    await this.auditService.log({
      action: 'VERIFY_VISIT',
      actorId,
      actorRole,
      targetEntityType: 'Visit',
      targetEntityId: saved.id,
      metadata: {
        status: saved.status,
        verified: true,
      },
    });

    return {
      visitId: saved.id,
      hallTicketNumber: saved.hallTicketNumber,
      status: saved.status,
      isVerified: saved.isVerified,
    };
  }

  async rejectVerification(id: string, dto: RejectVerificationDto, receptionistId?: string) {
    const visit = await this.visitRepository.findOne({ where: { id } });
    if (!visit) {
      throw new NotFoundException(`Visit with ID ${id} not found`);
    }

    assertTransition(visit.status, VisitStatus.CANCELLED);

    visit.status = VisitStatus.CANCELLED;
    if (receptionistId) visit.receptionistId = receptionistId;
    await this.visitRepository.save(visit);

    const actorId = receptionistId ?? null;
    const actorRole = await this.resolveActorRole(actorId);
    await this.auditService.log({
      action: 'REJECT_VERIFICATION',
      actorId,
      actorRole,
      targetEntityType: 'Visit',
      targetEntityId: visit.id,
      metadata: {
        status: visit.status,
        reason: dto.reason,
      },
    });

    return {
      visitId: visit.id,
      status: visit.status,
      reason: dto.reason,
      message: 'Visit verification rejected by reception.',
    };
  }

  async assignClinic(id: string, dto: AssignClinicDto, receptionistId?: string) {
    return await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const visitRepo = manager.getRepository(Visit);
      const departmentRepo = manager.getRepository(Department);

      const visit = await visitRepo.findOne({
        where: { id },
        relations: { patient: true },
      });
      if (!visit) {
        throw new NotFoundException(`Visit with ID ${id} not found`);
      }

      assertTransition(visit.status, VisitStatus.TRIAGE_PENDING);

      const department = await departmentRepo.findOne({
        where: { code: dto.departmentCode },
      });
      if (!department) {
        throw new NotFoundException(`Department with code ${dto.departmentCode} not found`);
      }

      // Capacity & Quota validation
      const { start, end } = this.getTodayBounds();
      const currentOccupancy = await visitRepo.count({
        where: {
          currentDepartmentId: department.id,
          createdAt: Between(start, end),
          status: In([
            VisitStatus.TRIAGE_PENDING,
            VisitStatus.CLINIC_WAITING,
            VisitStatus.IN_EXAMINATION,
            VisitStatus.PARACLINICAL_PENDING,
            VisitStatus.RE_EXAM_CALLING,
            VisitStatus.COMPLETED,
          ]),
        },
      });

      if (currentOccupancy >= department.maxQuotaPerSlot) {
        throw new ConflictException(
          `Clinic ${dto.departmentCode} has reached its maximum quota for the current shift. Please select an alternate clinic.`,
        );
      }

      // Elderly Priority Check (> 80 years old)
      let isPriority = !!dto.isPriority;
      let priorityReason = dto.priorityReason;
      if (visit.patient && visit.patient.dateOfBirth) {
        const ageDiffMs = Date.now() - new Date(visit.patient.dateOfBirth).getTime();
        const ageDate = new Date(ageDiffMs);
        const age = Math.abs(ageDate.getUTCFullYear() - 1970);
        if (age >= ELDERLY_PRIORITY_AGE) {
          isPriority = true;
          priorityReason = priorityReason || 'Elderly patient over 80 years old';
        }
      }

      // Clinic Ticket Number (e.g. IM-001 or CL-102-01)
      const prefix = department.code.replace('P.', 'CL-');
      const clinicTicketNumber = `${prefix}-${String(currentOccupancy + 1).padStart(2, '0')}`;

      visit.initialDepartmentId = department.id;
      visit.currentDepartmentId = department.id;
      visit.clinicTicketNumber = clinicTicketNumber;
      visit.status = VisitStatus.TRIAGE_PENDING;
      visit.isPriority = isPriority;
      visit.priorityReason = priorityReason;
      if (receptionistId) visit.receptionistId = receptionistId;

      const saved = await visitRepo.save(visit);

      const actorId = receptionistId ?? null;
      const actorRole = await this.resolveActorRole(actorId, manager);
      await this.auditService.log(
        {
          action: 'ASSIGN_CLINIC',
          actorId,
          actorRole,
          targetEntityType: 'Visit',
          targetEntityId: saved.id,
          metadata: {
            status: saved.status,
            clinicTicketNumber: saved.clinicTicketNumber,
            departmentCode: department.code,
            isPriority: saved.isPriority,
          },
        },
        manager,
      );

      return {
        visitId: saved.id,
        clinicTicketNumber: saved.clinicTicketNumber,
        departmentCode: department.code,
        departmentName: department.name,
        status: saved.status,
        isPriority: saved.isPriority,
        priorityReason: saved.priorityReason,
      };
    });
  }

  async recordVitalSigns(id: string, dto: RecordVitalsDto, nurseId: string) {
    const visit = await this.visitRepository.findOne({
      where: { id },
      relations: { initialDepartment: true },
    });
    if (!visit) {
      throw new NotFoundException(`Visit with ID ${id} not found`);
    }

    // Mandatory vitals validation
    if (
      dto.bloodPressureSystolic === undefined ||
      dto.bloodPressureDiastolic === undefined ||
      dto.heartRate === undefined ||
      dto.temperature === undefined ||
      dto.spo2 === undefined ||
      dto.respiratoryRate === undefined
    ) {
      throw new BadRequestException(
        'All 5 vital signs (BP, Heart Rate, Temp, SpO2, Resp Rate) are mandatory.',
      );
    }

    // Calculate pure NEWS2 score across the 5 physiological parameters
    const news2 = calculateNews2({
      respiratoryRate: dto.respiratoryRate,
      spo2: dto.spo2,
      bloodPressureSystolic: dto.bloodPressureSystolic,
      heartRate: dto.heartRate,
      temperature: dto.temperature,
    });

    // Red flag / STAT Emergency trigger
    const isSevereHypoxia = dto.spo2 < 90;
    const isHypotensionShock = dto.bloodPressureSystolic < 90;
    const isHighNews2 = news2.score >= 7;
    const isRedFlag = isSevereHypoxia || isHypotensionShock || isHighNews2 || !!dto.isRedFlag;

    const targetStatus = isRedFlag ? VisitStatus.EMERGENCY_DISPATCHED : VisitStatus.CLINIC_WAITING;
    assertTransition(visit.status, targetStatus);

    let vital = await this.vitalRepository.findOne({ where: { visitId: id } });
    if (!vital) {
      vital = this.vitalRepository.create({ visitId: id, nurseId });
    }

    vital.nurseId = nurseId;
    vital.bloodPressureSystolic = dto.bloodPressureSystolic;
    vital.bloodPressureDiastolic = dto.bloodPressureDiastolic;
    vital.heartRate = dto.heartRate;
    vital.temperature = dto.temperature;
    vital.spo2 = dto.spo2;
    vital.respiratoryRate = dto.respiratoryRate;
    vital.weightKg = dto.weightKg;
    vital.heightCm = dto.heightCm;
    vital.news2Score = news2.score;
    vital.news2Risk = news2.risk;
    vital.notes = dto.notes;

    if (isRedFlag) {
      vital.isRedFlag = true;
      let defaultReason: string;
      if (isSevereHypoxia) {
        defaultReason = 'Severe hypoxia with SpO2 < 90%';
      } else if (isHypotensionShock) {
        defaultReason = 'Hemodynamic instability / hypotension';
      } else if (isHighNews2) {
        defaultReason = `High clinical risk (NEWS2 score: ${news2.score})`;
      } else {
        defaultReason = 'Clinical red flag vitals detected';
      }

      vital.redFlagReason = dto.redFlagReason || defaultReason;

      const erDept = await this.departmentRepository.findOne({
        where: { code: DEPARTMENT_CODES.EMERGENCY },
      });
      visit.status = VisitStatus.EMERGENCY_DISPATCHED;
      visit.isPriority = true;
      visit.priorityReason = 'STAT EMERGENCY: Red flag vitals detected at nurse station';
      if (erDept) visit.currentDepartmentId = erDept.id;
    } else {
      vital.isRedFlag = false;
      vital.redFlagReason = undefined;
      visit.status = VisitStatus.CLINIC_WAITING;
    }

    await this.vitalRepository.save(vital);
    await this.visitRepository.save(visit);

    const actorId = nurseId ?? null;
    const actorRole = await this.resolveActorRole(actorId);
    await this.auditService.log({
      action: 'RECORD_VITAL_SIGNS',
      actorId,
      actorRole,
      targetEntityType: 'Visit',
      targetEntityId: visit.id,
      metadata: {
        status: visit.status,
        vitalId: vital.id,
        isRedFlag: vital.isRedFlag,
        news2Score: vital.news2Score,
      },
    });

    return {
      visitId: visit.id,
      status: visit.status,
      isRedFlag: vital.isRedFlag,
      redFlagReason: vital.redFlagReason,
      news2Score: vital.news2Score,
      news2Risk: vital.news2Risk,
      news2Components: news2.components,
      vitals: vital,
    };
  }

  async emergencyDispatch(id: string, dto: EmergencyDispatchDto, staffId?: string) {
    const visit = await this.visitRepository.findOne({ where: { id } });
    if (!visit) {
      throw new NotFoundException(`Visit with ID ${id} not found`);
    }

    assertTransition(visit.status, VisitStatus.EMERGENCY_DISPATCHED);

    const erDept = await this.departmentRepository.findOne({
      where: { code: DEPARTMENT_CODES.EMERGENCY },
    });
    visit.status = VisitStatus.EMERGENCY_DISPATCHED;
    visit.isPriority = true;
    visit.priorityReason = `STAT EMERGENCY DISPATCH: ${dto.reason}`;
    if (erDept) visit.currentDepartmentId = erDept.id;

    await this.visitRepository.save(visit);

    const actorId = staffId ?? null;
    const actorRole = await this.resolveActorRole(actorId);
    await this.auditService.log({
      action: 'EMERGENCY_DISPATCH',
      actorId,
      actorRole,
      targetEntityType: 'Visit',
      targetEntityId: visit.id,
      metadata: {
        status: visit.status,
        destinationRoom: DEPARTMENT_CODES.EMERGENCY,
        reason: dto.reason,
      },
    });

    return {
      visitId: visit.id,
      status: visit.status,
      reason: dto.reason,
      destinationRoom: DEPARTMENT_CODES.EMERGENCY,
      alert: '🚨 STAT EMERGENCY DISPATCH TRIGGERED!',
    };
  }

  async callPatient(id: string, doctorId: string) {
    const visit = await this.visitRepository.findOne({ where: { id } });
    if (!visit) {
      throw new NotFoundException(`Visit with ID ${id} not found`);
    }

    assertTransition(visit.status, VisitStatus.IN_EXAMINATION);

    visit.status = VisitStatus.IN_EXAMINATION;
    visit.currentDoctorId = doctorId;
    await this.visitRepository.save(visit);

    const actorId = doctorId ?? null;
    const actorRole = await this.resolveActorRole(actorId);
    await this.auditService.log({
      action: 'CALL_PATIENT',
      actorId,
      actorRole,
      targetEntityType: 'Visit',
      targetEntityId: visit.id,
      metadata: {
        status: visit.status,
      },
    });

    return {
      visitId: visit.id,
      status: visit.status,
      currentDoctorId: visit.currentDoctorId,
    };
  }

  async transferClinic(id: string, dto: TransferClinicDto, doctorId: string) {
    void doctorId;
    const visit = await this.visitRepository.findOne({ where: { id } });
    if (!visit) {
      throw new NotFoundException(`Visit with ID ${id} not found`);
    }

    assertTransition(visit.status, VisitStatus.CLINIC_WAITING);

    const targetDept = await this.departmentRepository.findOne({
      where: { code: dto.targetDepartmentCode },
    });
    if (!targetDept) {
      throw new NotFoundException(`Target clinic ${dto.targetDepartmentCode} not found`);
    }

    visit.currentDepartmentId = targetDept.id;
    visit.status = VisitStatus.CLINIC_WAITING;
    visit.isPriority = true;
    visit.priorityReason = `Transferred from previous clinic: ${dto.transferReason}`;
    await this.visitRepository.save(visit);

    return {
      visitId: visit.id,
      status: visit.status,
      targetDepartmentCode: targetDept.code,
      targetDepartmentName: targetDept.name,
      priorityReason: visit.priorityReason,
      clinicalSummary: dto.clinicalSummary,
    };
  }

  async concludeVisit(id: string, dto: ConcludeVisitDto, doctorId: string) {
    return await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const visitRepo = manager.getRepository(Visit);
      const prescriptionRepo = manager.getRepository(Prescription);
      const itemRepo = manager.getRepository(PrescriptionItem);

      const visit = await visitRepo.findOne({
        where: { id },
        relations: { patient: true },
      });
      if (!visit) {
        throw new NotFoundException(`Visit with ID ${id} not found`);
      }

      if (visit.status === VisitStatus.COMPLETED) {
        throw new ConflictException('Visit has already been concluded.');
      }

      assertTransition(visit.status, VisitStatus.COMPLETED);

      // Allergy check
      const patientAllergies = visit.patient?.allergies || [];
      if (dto.items && dto.items.length > 0) {
        for (const item of dto.items) {
          const conflict = checkAllergyConflict(item.medicationName, patientAllergies);
          if (conflict) {
            throw new UnprocessableEntityException(
              `ALLERGY SAFETY WARNING: Patient has documented allergy to ${conflict}. ` +
                `Medication "${item.medicationName}" is contraindicated. ` +
                `Prescription cannot be signed without override authorization.`,
            );
          }
        }
      }

      const signaturePayload = JSON.stringify({
        doctorId,
        visitId: id,
        icd10Code: dto.icd10Code,
        timestamp: new Date().toISOString(),
      });
      const digitalSignature = createHmac('sha256', this.config.signatureSecret)
        .update(signaturePayload)
        .digest('hex');

      // Save prescription
      let prescription = await prescriptionRepo.findOne({ where: { visitId: id } });
      if (!prescription) {
        prescription = prescriptionRepo.create({
          visitId: id,
          doctorId,
          icd10Code: dto.icd10Code,
          icd10Name: dto.icd10Name,
          notes: dto.doctorNotes,
          revisitDate: dto.revisitDate ? new Date(dto.revisitDate) : undefined,
          digitalSignature,
        });
      } else {
        prescription.doctorId = doctorId;
        prescription.icd10Code = dto.icd10Code;
        prescription.icd10Name = dto.icd10Name;
        prescription.notes = dto.doctorNotes;
        prescription.revisitDate = dto.revisitDate ? new Date(dto.revisitDate) : undefined;
        prescription.digitalSignature = digitalSignature;
      }
      const savedPrescription = await prescriptionRepo.save(prescription);

      // Save items
      if (dto.items && dto.items.length > 0) {
        await itemRepo.delete({ prescriptionId: savedPrescription.id });
        for (const itemDto of dto.items) {
          const item = itemRepo.create({
            prescriptionId: savedPrescription.id,
            medicationName: itemDto.medicationName,
            dosage: itemDto.dosage,
            route: itemDto.route || 'ORAL',
            frequency: itemDto.frequency,
            durationDays: itemDto.durationDays || 7,
            quantity: itemDto.quantity || 1,
            instructions: itemDto.instructions,
          });
          await itemRepo.save(item);
        }
      }

      visit.status = VisitStatus.COMPLETED;
      await visitRepo.save(visit);

      const actorId = doctorId ?? null;
      const actorRole = await this.resolveActorRole(actorId, manager);
      await this.auditService.log(
        {
          action: 'CONCLUDE_VISIT',
          actorId,
          actorRole,
          targetEntityType: 'Visit',
          targetEntityId: visit.id,
          metadata: {
            status: visit.status,
            prescriptionId: savedPrescription.id,
            icd10Code: savedPrescription.icd10Code,
          },
        },
        manager,
      );

      return {
        visitId: visit.id,
        status: visit.status,
        prescriptionId: savedPrescription.id,
        icd10Code: savedPrescription.icd10Code,
        icd10Name: savedPrescription.icd10Name,
        digitalSignature: savedPrescription.digitalSignature,
      };
    });
  }

  async getRoute(id: string) {
    const visit = await this.visitRepository.findOne({
      where: { id },
      relations: {
        initialDepartment: true,
        currentDepartment: true,
        steps: { department: true },
      },
    });

    if (!visit) {
      throw new NotFoundException(`Visit with ID ${id} not found`);
    }

    const steps = visit.steps || [];
    steps.sort((a: VisitStep, b: VisitStep) => a.sequenceOrder - b.sequenceOrder);

    const currentFloor = visit.currentDepartment?.floor || 1;

    // Weighted cost heuristic: Cost = 0.7 * (queueWait) + 0.3 * (|floorDiff|)
    const routeStations = steps.map((s: VisitStep) => {
      const dept = s.department;
      const queueWait = dept ? dept.avgServiceTimeMin * 2 : 10;
      const floorDiff = dept ? Math.abs(dept.floor - currentFloor) : 0;
      const estimatedCost = Number(
        (
          QUEUE_PRIORITY_DEFAULTS.alphaWaitWeight * queueWait +
          QUEUE_PRIORITY_DEFAULTS.betaDistanceWeight * floorDiff
        ).toFixed(2),
      );

      return {
        stepId: s.id,
        sequenceOrder: s.sequenceOrder,
        status: s.status,
        departmentCode: dept?.code,
        departmentName: dept?.name,
        floor: dept?.floor,
        roomType: dept?.roomType,
        estimatedWaitMin: queueWait,
        heuristicCost: estimatedCost,
        isReExam: s.isReExam,
      };
    });

    return {
      visitId: visit.id,
      clinicTicketNumber: visit.clinicTicketNumber,
      hallTicketNumber: visit.hallTicketNumber,
      currentStatus: visit.status,
      currentFloor,
      routeStations,
    };
  }

  async getQueue(departmentCode: string) {
    const dept = await this.departmentRepository.findOne({ where: { code: departmentCode } });
    if (!dept) {
      throw new NotFoundException(`Department with code ${departmentCode} not found`);
    }

    const { start, end } = this.getTodayBounds();

    const activeVisits = await this.visitRepository.find({
      where: {
        currentDepartmentId: dept.id,
        createdAt: Between(start, end),
        status: In([
          VisitStatus.TRIAGE_PENDING,
          VisitStatus.CLINIC_WAITING,
          VisitStatus.IN_EXAMINATION,
          VisitStatus.RE_EXAM_CALLING,
        ]),
      },
      relations: { patient: true, vital: true },
      order: {
        isPriority: 'DESC',
        createdAt: 'ASC',
      },
    });

    return {
      departmentCode: dept.code,
      departmentName: dept.name,
      queueLength: activeVisits.length,
      queue: activeVisits.map((v) => ({
        visitId: v.id,
        clinicTicketNumber: v.clinicTicketNumber,
        hallTicketNumber: v.hallTicketNumber,
        patientName: v.patient?.name,
        status: v.status,
        isPriority: v.isPriority,
        priorityReason: v.priorityReason,
        createdAt: v.createdAt,
        vitals: v.vital
          ? {
              bp: `${v.vital.bloodPressureSystolic}/${v.vital.bloodPressureDiastolic}`,
              hr: v.vital.heartRate,
              temp: v.vital.temperature,
              spo2: v.vital.spo2,
              isRedFlag: v.vital.isRedFlag,
            }
          : null,
      })),
    };
  }

  async getVisitDetails(id: string, callerId: string, callerRole: Role, includePatientPii = false) {
    const visit = await this.visitRepository.findOne({
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

    if (!visit) {
      throw new NotFoundException(`Visit with ID ${id} not found`);
    }

    // PATIENT role may only read their own visit
    if (callerRole === Role.PATIENT && visit.patientId !== callerId) {
      throw new ForbiddenException('Patients may only access their own visit records.');
    }

    const prescription = await this.prescriptionRepository.findOne({
      where: { visitId: id },
      relations: { items: true, doctor: true },
    });

    // Map to safe DTO — never spread raw entity
    return toVisitDossier(visit, prescription, includePatientPii);
  }

  async evaluateParaclinicalCompletion(visitId: string, remainingPendingSteps: number) {
    const visit = await this.visitRepository.findOne({ where: { id: visitId } });
    if (!visit) throw new NotFoundException('Visit not found');

    if (remainingPendingSteps === 0) {
      visit.status = VisitStatus.RE_EXAM_CALLING;
      visit.isPriority = true;
      visit.priorityReason = 'Priority Recall: All diagnostic results completed';
    }

    return await this.visitRepository.save(visit);
  }
}
