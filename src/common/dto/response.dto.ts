/**
 * Safe response DTOs — strip all sensitive PII before hitting the wire.
 *
 * Rule: Controllers must NEVER return raw TypeORM entities.
 *       Always use one of these mappers to project only the fields
 *       that a given caller role is allowed to see.
 */

// ─── User Profiles ───────────────────────────────────────────────────────────

/** Minimal identity for embedding inside Visit or queue payloads */
export interface UserMinimalDto {
  id: string;
  name: string;
}

/** Public-safe profile: no PII beyond name/role/contact */
export interface UserPublicDto {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  gender?: string;
  dateOfBirth?: Date;
  isActive: boolean;
}

/** Full profile with PII — only for ADMIN / RECEPTIONIST role */
export interface UserFullDto extends UserPublicDto {
  nationalId?: string;
  insuranceCardNumber?: string;
  allergies?: string[];
}

/** /auth/me — authenticated user sees their own profile (no password) */
export interface MeResponseDto extends UserFullDto {
  createdAt: Date;
  updatedAt: Date;
}

// ─── Visit Dossier ───────────────────────────────────────────────────────────

export interface VisitPatientSummaryDto {
  id: string;
  name: string;
  dateOfBirth?: Date;
  gender?: string;
  allergies?: string[];
  /** Only included when caller has RECEPTIONIST or ADMIN role */
  nationalId?: string;
  /** Only included when caller has RECEPTIONIST or ADMIN role */
  insuranceCardNumber?: string;
}

export interface VisitDossierDto {
  visitId: string;
  hallTicketNumber: string;
  clinicTicketNumber?: string;
  status: string;
  chiefComplaint?: string;
  symptomOnset?: string;
  symptomDuration?: string;
  symptomSeverity?: number;
  isPriority: boolean;
  priorityReason?: string;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  patient: VisitPatientSummaryDto;
  /** Doctor/Nurse identity without sensitive fields */
  receptionist?: UserMinimalDto;
  currentDoctor?: UserMinimalDto;
  initialDepartment?: DepartmentSummaryDto;
  currentDepartment?: DepartmentSummaryDto;
  vital?: VitalSummaryDto;
  steps?: StepSummaryDto[];
  prescription?: PrescriptionSummaryDto;
}

export interface DepartmentSummaryDto {
  id: string;
  code: string;
  name: string;
  floor?: number;
  roomType?: string;
}

export interface VitalSummaryDto {
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  heartRate?: number;
  temperature?: number;
  spo2?: number;
  respiratoryRate?: number;
  isRedFlag?: boolean;
  redFlagReason?: string;
  notes?: string;
}

export interface StepSummaryDto {
  stepId: string;
  sequenceOrder: number;
  status: string;
  isReExam: boolean;
  department?: DepartmentSummaryDto;
}

export interface PrescriptionSummaryDto {
  id: string;
  icd10Code?: string;
  icd10Name?: string;
  notes?: string;
  revisitDate?: Date;
  digitalSignature?: string;
  doctor?: UserMinimalDto;
  items?: PrescriptionItemSummaryDto[];
}

export interface PrescriptionItemSummaryDto {
  id: string;
  medicationName: string;
  dosage?: string;
  route?: string;
  frequency?: string;
  durationDays?: number;
  quantity?: number;
  instructions?: string;
}

// ─── Mapper helpers ───────────────────────────────────────────────────────────

export function toUserMinimal(user: any): UserMinimalDto | undefined {
  if (!user) return undefined;
  return { id: user.id, name: user.name };
}

export function toUserPublic(user: any): UserPublicDto | undefined {
  if (!user) return undefined;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    gender: user.gender,
    dateOfBirth: user.dateOfBirth,
    isActive: user.isActive,
  };
}

export function toUserFull(user: any): UserFullDto | undefined {
  if (!user) return undefined;
  return {
    ...toUserPublic(user)!,
    nationalId: user.nationalId,
    insuranceCardNumber: user.insuranceCardNumber,
    allergies: user.allergies,
  };
}

export function toMeResponse(user: any): MeResponseDto | undefined {
  if (!user) return undefined;
  return {
    ...toUserFull(user)!,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function toDepartmentSummary(dept: any): DepartmentSummaryDto | undefined {
  if (!dept) return undefined;
  return {
    id: dept.id,
    code: dept.code,
    name: dept.name,
    floor: dept.floor,
    roomType: dept.roomType,
  };
}

export function toVitalSummary(vital: any): VitalSummaryDto | undefined {
  if (!vital) return undefined;
  return {
    bloodPressureSystolic: vital.bloodPressureSystolic,
    bloodPressureDiastolic: vital.bloodPressureDiastolic,
    heartRate: vital.heartRate,
    temperature: vital.temperature,
    spo2: vital.spo2,
    respiratoryRate: vital.respiratoryRate,
    isRedFlag: vital.isRedFlag,
    redFlagReason: vital.redFlagReason,
    notes: vital.notes,
  };
}

export function toStepSummary(step: any): StepSummaryDto {
  return {
    stepId: step.id,
    sequenceOrder: step.sequenceOrder,
    status: step.status,
    isReExam: step.isReExam,
    department: toDepartmentSummary(step.department),
  };
}

export function toPrescriptionSummary(prescription: any): PrescriptionSummaryDto | undefined {
  if (!prescription) return undefined;
  return {
    id: prescription.id,
    icd10Code: prescription.icd10Code,
    icd10Name: prescription.icd10Name,
    notes: prescription.notes,
    revisitDate: prescription.revisitDate,
    digitalSignature: prescription.digitalSignature,
    doctor: toUserMinimal(prescription.doctor),
    items: prescription.items?.map((item: any): PrescriptionItemSummaryDto => ({
      id: item.id,
      medicationName: item.medicationName,
      dosage: item.dosage,
      route: item.route,
      frequency: item.frequency,
      durationDays: item.durationDays,
      quantity: item.quantity,
      instructions: item.instructions,
    })),
  };
}

/**
 * Map a full Visit entity + prescription into a safe VisitDossierDto.
 * @param visit  — Loaded TypeORM Visit entity with relations
 * @param prescription — Optional loaded Prescription with items + doctor
 * @param includePatientPii — Set true only when caller has RECEPTIONIST/ADMIN role
 */

export function toVisitDossier(
  visit: any,
  prescription: any,
  includePatientPii = false,
): VisitDossierDto {
  const patient = visit.patient;
  const patientDto: VisitPatientSummaryDto = {
    id: patient?.id,
    name: patient?.name,
    dateOfBirth: patient?.dateOfBirth,
    gender: patient?.gender,
    allergies: patient?.allergies,
    ...(includePatientPii
      ? {
          nationalId: patient?.nationalId,
          insuranceCardNumber: patient?.insuranceCardNumber,
        }
      : {}),
  };

  return {
    visitId: visit.id,
    hallTicketNumber: visit.hallTicketNumber,
    clinicTicketNumber: visit.clinicTicketNumber,
    status: visit.status,
    chiefComplaint: visit.chiefComplaint,
    symptomOnset: visit.symptomOnset,
    symptomDuration: visit.symptomDuration,
    symptomSeverity: visit.symptomSeverity,
    isPriority: visit.isPriority,
    priorityReason: visit.priorityReason,
    isVerified: visit.isVerified,
    createdAt: visit.createdAt,
    updatedAt: visit.updatedAt,
    patient: patientDto,
    receptionist: toUserMinimal(visit.receptionist),
    currentDoctor: toUserMinimal(visit.currentDoctor),
    initialDepartment: toDepartmentSummary(visit.initialDepartment),
    currentDepartment: toDepartmentSummary(visit.currentDepartment),
    vital: toVitalSummary(visit.vital),
    steps: visit.steps?.map(toStepSummary),
    prescription: toPrescriptionSummary(prescription),
  };
}
