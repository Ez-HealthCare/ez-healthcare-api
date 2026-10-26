import * as bcrypt from 'bcrypt';
import { SEED_USERS, SEED_DEPARTMENTS, SEED_RULES } from '../../common/constants/seed.constants';
import { BCRYPT_SALT_ROUNDS } from '../../common/constants/auth.constants';
import {
  QUEUE_PRIORITY_CONFIG_KEY,
  QUEUE_PRIORITY_DEFAULTS,
} from '../../common/constants/clinical.constants';
import dataSource from '../data-source';
import { User } from '../entities/user.entity';
import { Department } from '../../department/entities/department.entity';
import { DoctorSchedule } from '../../department/entities/doctor-schedule.entity';
import { ShiftType } from '../../department/enums/shift-type.enum';
import { Role } from '../../user/enums/role.enum';
import { getBusinessTime } from '../../visit/business-time';
import { TriageRule } from '../../triage/entities/triage-rule.entity';
import { SystemConfig } from '../../admin/entities/system-config.entity';
import { Visit } from '../../visit/entities/visit.entity';
import { VisitVital } from '../../visit/entities/visit-vital.entity';
import { VisitOrder } from '../../visit/entities/visit-order.entity';
import { VisitStep } from '../../visit/entities/visit-step.entity';
import { QueueTicket } from '../../visit/entities/queue-ticket.entity';
import { VisitStatus } from '../../visit/enums/visit-status.enum';
import {
  QueueTicketKind,
  QueueTicketOperation,
  QueueTicketStatus,
} from '../../visit/enums/queue-ticket.enum';
import { StepStatus } from '../../visit/enums/step-status.enum';
import { ParaclinicalResult } from '../../paraclinical/entities/paraclinical-result.entity';
import { Appointment } from '../../appointment/entities/appointment.entity';
import { AppointmentStatus } from '../../appointment/enums/appointment-status.enum';

type DemoVisitFixture = {
  key: string;
  patientEmail: string;
  hallTicketNumber: string;
  clinicTicketNumber?: string;
  status: VisitStatus;
  ticketKind: QueueTicketKind;
  ticketStatus: QueueTicketStatus;
  ticketScope: string;
  ticketSequence: number;
  chiefComplaint?: string;
  intakeCompleted: boolean;
  isPriority?: boolean;
  priorityReason?: string;
  currentDoctorEmail?: string;
  departmentCode?: string;
  redFlag?: boolean;
  callAttempts?: number;
  lastCalledMinutesAgo?: number;
};

const DEMO_VISITS: DemoVisitFixture[] = [
  {
    key: 'hall-waiting',
    patientEmail: 'patient.david@example.com',
    hallTicketNumber: 'DEMO-H-001',
    status: VisitStatus.HALL_WAITING,
    ticketKind: QueueTicketKind.HALL,
    ticketStatus: QueueTicketStatus.ACTIVE,
    ticketScope: 'FACILITY',
    ticketSequence: 9001,
    intakeCompleted: false,
  },
  {
    key: 'verified',
    patientEmail: 'patient.elizabeth@example.com',
    hallTicketNumber: 'DEMO-H-002',
    status: VisitStatus.RECEPTION_VERIFIED,
    ticketKind: QueueTicketKind.HALL,
    ticketStatus: QueueTicketStatus.ACTIVE,
    ticketScope: 'FACILITY',
    ticketSequence: 9002,
    intakeCompleted: false,
    isPriority: true,
    priorityReason: 'Elderly patient over 80 years old',
  },
  {
    key: 'hall-called',
    patientEmail: 'patient.sophia@example.com',
    hallTicketNumber: 'DEMO-H-010',
    status: VisitStatus.HALL_WAITING,
    ticketKind: QueueTicketKind.HALL,
    ticketStatus: QueueTicketStatus.ACTIVE,
    ticketScope: 'FACILITY',
    ticketSequence: 9010,
    chiefComplaint: 'Walk-in registration: headache and dizziness',
    intakeCompleted: false,
    callAttempts: 2,
    lastCalledMinutesAgo: 3,
  },
  {
    key: 'hall-paused',
    patientEmail: 'patient.robert@example.com',
    hallTicketNumber: 'DEMO-H-011',
    status: VisitStatus.HALL_WAITING,
    ticketKind: QueueTicketKind.HALL,
    ticketStatus: QueueTicketStatus.PAUSED,
    ticketScope: 'FACILITY',
    ticketSequence: 9011,
    chiefComplaint: 'Walk-in registration: follow-up consultation',
    intakeCompleted: false,
    callAttempts: 1,
    lastCalledMinutesAgo: 8,
  },
  {
    key: 'triage-pending',
    patientEmail: 'patient.michael@example.com',
    hallTicketNumber: 'DEMO-H-003',
    status: VisitStatus.TRIAGE_PENDING,
    ticketKind: QueueTicketKind.HALL,
    ticketStatus: QueueTicketStatus.ACTIVE,
    ticketScope: 'FACILITY',
    ticketSequence: 9003,
    chiefComplaint: 'Đau bụng âm ỉ sau ăn',
    intakeCompleted: true,
  },
  {
    key: 'clinic-waiting',
    patientEmail: 'patient.linda@example.com',
    hallTicketNumber: 'DEMO-H-004',
    clinicTicketNumber: 'DEMO-CL-001',
    status: VisitStatus.CLINIC_WAITING,
    ticketKind: QueueTicketKind.CLINIC,
    ticketStatus: QueueTicketStatus.ACTIVE,
    ticketScope: 'P.102',
    ticketSequence: 9001,
    departmentCode: 'P.102',
    chiefComplaint: 'Đau đầu và chóng mặt hai ngày',
    intakeCompleted: true,
  },
  {
    key: 'clinic-called',
    patientEmail: 'patient.aaron@example.com',
    hallTicketNumber: 'DEMO-H-005',
    clinicTicketNumber: 'DEMO-CL-002',
    status: VisitStatus.CLINIC_CALLED,
    ticketKind: QueueTicketKind.CLINIC,
    ticketStatus: QueueTicketStatus.ACTIVE,
    ticketScope: 'P.102',
    ticketSequence: 9002,
    departmentCode: 'P.102',
    chiefComplaint: 'Ho khan và tức ngực nhẹ',
    intakeCompleted: true,
    currentDoctorEmail: 'dr.smith@ezhealthcare.com',
  },
  {
    key: 'in-examination',
    patientEmail: 'patient.sophia@example.com',
    hallTicketNumber: 'DEMO-H-006',
    clinicTicketNumber: 'DEMO-CL-003',
    status: VisitStatus.IN_EXAMINATION,
    ticketKind: QueueTicketKind.CLINIC,
    ticketStatus: QueueTicketStatus.COMPLETED,
    ticketScope: 'P.102',
    ticketSequence: 9003,
    departmentCode: 'P.102',
    chiefComplaint: 'Đau vùng thượng vị',
    intakeCompleted: true,
    currentDoctorEmail: 'dr.smith@ezhealthcare.com',
  },
  {
    key: 'paraclinical-pending',
    patientEmail: 'patient.james@example.com',
    hallTicketNumber: 'DEMO-H-007',
    clinicTicketNumber: 'DEMO-CL-004',
    status: VisitStatus.PARACLINICAL_PENDING,
    ticketKind: QueueTicketKind.CLINIC,
    ticketStatus: QueueTicketStatus.COMPLETED,
    ticketScope: 'P.102',
    ticketSequence: 9004,
    departmentCode: 'P.102',
    chiefComplaint: 'Sốt và đau bụng cần làm xét nghiệm',
    intakeCompleted: true,
    currentDoctorEmail: 'dr.smith@ezhealthcare.com',
  },
  {
    key: 're-exam-calling',
    patientEmail: 'patient.amelia@example.com',
    hallTicketNumber: 'DEMO-H-008',
    clinicTicketNumber: 'DEMO-CL-005',
    status: VisitStatus.RE_EXAM_CALLING,
    ticketKind: QueueTicketKind.CLINIC,
    ticketStatus: QueueTicketStatus.COMPLETED,
    ticketScope: 'P.102',
    ticketSequence: 9005,
    departmentCode: 'P.102',
    chiefComplaint: 'Tái khám sau khi có kết quả xét nghiệm',
    intakeCompleted: true,
    currentDoctorEmail: 'dr.smith@ezhealthcare.com',
    isPriority: true,
    priorityReason: 'Priority Recall: All diagnostic results completed',
  },
  {
    key: 'emergency',
    patientEmail: 'patient.robert@example.com',
    hallTicketNumber: 'DEMO-H-009',
    status: VisitStatus.EMERGENCY_DISPATCHED,
    ticketKind: QueueTicketKind.HALL,
    ticketStatus: QueueTicketStatus.COMPLETED,
    ticketScope: 'FACILITY',
    ticketSequence: 9009,
    departmentCode: 'P.001',
    chiefComplaint: 'Đau ngực dữ dội, khó thở',
    intakeCompleted: true,
    isPriority: true,
    priorityReason: 'Clinical red flag: suspected acute coronary syndrome',
    redFlag: true,
  },
];

async function seedDemoScenarios(
  users: Map<string, User>,
  departments: Map<string, Department>,
): Promise<Map<string, Visit>> {
  const visitRepo = dataSource.getRepository(Visit);
  const vitalRepo = dataSource.getRepository(VisitVital);
  const ticketRepo = dataSource.getRepository(QueueTicket);
  const orderRepo = dataSource.getRepository(VisitOrder);
  const stepRepo = dataSource.getRepository(VisitStep);
  const resultRepo = dataSource.getRepository(ParaclinicalResult);
  const { businessDate, expiresAt } = getBusinessTime();
  const receptionist = users.get('reception.clara@ezhealthcare.com');
  const nurse = users.get('nurse.emily@ezhealthcare.com');

  if (!receptionist || !nurse) {
    throw new Error('Demo staff accounts were not created.');
  }

  const visits = new Map<string, Visit>();
  for (const [index, fixture] of DEMO_VISITS.entries()) {
    const patient = users.get(fixture.patientEmail);
    const department = fixture.departmentCode ? departments.get(fixture.departmentCode) : undefined;
    const doctor = fixture.currentDoctorEmail ? users.get(fixture.currentDoctorEmail) : undefined;
    if (!patient || (fixture.departmentCode && !department) || (fixture.currentDoctorEmail && !doctor)) {
      throw new Error(`Demo fixture ${fixture.key} is missing its required user or department.`);
    }

    let visit = await visitRepo.findOne({ where: { hallTicketNumber: fixture.hallTicketNumber } });
    visit ??= visitRepo.create({ patientId: patient.id, hallTicketNumber: fixture.hallTicketNumber });
    Object.assign(visit, {
      patientId: patient.id,
      hallTicketNumber: fixture.hallTicketNumber,
      clinicTicketNumber: fixture.clinicTicketNumber,
      receptionistId: receptionist.id,
      currentDoctorId: doctor?.id,
      initialDepartmentId: department?.id,
      currentDepartmentId: department?.id,
      status: fixture.status,
      isPriority: !!fixture.isPriority,
      priorityReason: fixture.priorityReason,
      chiefComplaint: fixture.chiefComplaint,
      symptomOnset: fixture.intakeCompleted ? 'Hôm nay' : undefined,
      symptomDuration: fixture.intakeCompleted ? '2 ngày' : undefined,
      symptomSeverity: fixture.redFlag ? 'Nặng' : fixture.intakeCompleted ? 'Trung bình' : undefined,
      isVerified: fixture.status !== VisitStatus.HALL_WAITING,
      intakeCompletedAt: fixture.intakeCompleted ? new Date(Date.now() - 20 * 60 * 1000) : undefined,
      hallReissueCount: 0,
    });
    visit = await visitRepo.save(visit);
    visits.set(fixture.key, visit);

    await ticketRepo
      .createQueryBuilder()
      .update(QueueTicket)
      .set({ status: QueueTicketStatus.SUPERSEDED })
      .where('visit_id = :visitId', { visitId: visit.id })
      .andWhere('idempotency_key <> :idempotencyKey', { idempotencyKey: `demo-seed-${fixture.key}` })
      .execute();

    let ticket = await ticketRepo.findOne({
      where: { idempotencyKey: `demo-seed-${fixture.key}` },
    });
    ticket ??= ticketRepo.create({
      visitId: visit.id,
      idempotencyKey: `demo-seed-${fixture.key}`,
    });
    Object.assign(ticket, {
      visitId: visit.id,
      kind: fixture.ticketKind,
      scopeKey: fixture.ticketScope,
      businessDate,
      sequence: fixture.ticketSequence,
      displayNumber: fixture.clinicTicketNumber ?? fixture.hallTicketNumber,
      status: fixture.ticketStatus,
      issuedById: fixture.ticketKind === QueueTicketKind.CLINIC ? receptionist.id : patient.id,
      operation:
        fixture.ticketKind === QueueTicketKind.CLINIC
          ? QueueTicketOperation.CLINIC_ASSIGN
          : QueueTicketOperation.HALL_ISSUE,
      requestFingerprint: `${fixture.key}`.padEnd(64, '0').slice(0, 64),
      queuedAt: new Date(Date.now() - (index + 1) * 5 * 60 * 1000),
      expiresAt,
      callAttempts:
        fixture.callAttempts ?? (fixture.status === VisitStatus.CLINIC_CALLED ? 1 : 0),
      lastCalledAt: fixture.lastCalledMinutesAgo
        ? new Date(Date.now() - fixture.lastCalledMinutesAgo * 60 * 1000)
        : fixture.status === VisitStatus.CLINIC_CALLED
          ? new Date()
          : undefined,
    });
    await ticketRepo.save(ticket);

    if (fixture.intakeCompleted) {
      let vital = await vitalRepo.findOne({ where: { visitId: visit.id } });
      vital ??= vitalRepo.create({ visitId: visit.id, nurseId: nurse.id });
      Object.assign(vital, {
        nurseId: nurse.id,
        bloodPressureSystolic: fixture.redFlag ? 82 : 118,
        bloodPressureDiastolic: fixture.redFlag ? 54 : 76,
        heartRate: fixture.redFlag ? 122 : 78,
        temperature: fixture.redFlag ? 38.7 : 36.8,
        spo2: fixture.redFlag ? 88 : 98,
        respiratoryRate: fixture.redFlag ? 28 : 16,
        weightKg: 62,
        heightCm: 168,
        news2Score: fixture.redFlag ? 9 : 0,
        news2Risk: fixture.redFlag ? 'HIGH' : 'LOW',
        isRedFlag: !!fixture.redFlag,
        redFlagReason: fixture.redFlag ? 'Hypotension and hypoxia require emergency dispatch' : undefined,
        notes: 'Demo vital signs for local workflow testing',
      });
      await vitalRepo.save(vital);
    }
  }

  const doctor = users.get('dr.smith@ezhealthcare.com');
  const bloodLab = departments.get('P.201');
  const ultrasound = departments.get('P.104');
  if (!doctor || !bloodLab || !ultrasound) {
    throw new Error('Demo diagnostic fixtures are missing their doctor or department.');
  }

  const pendingVisit = visits.get('paraclinical-pending');
  if (pendingVisit) {
    let order = await orderRepo.findOne({ where: { visitId: pendingVisit.id } });
    order ??= orderRepo.create({ visitId: pendingVisit.id, doctorId: doctor.id });
    Object.assign(order, {
      doctorId: doctor.id,
      workingDiagnosis: 'Abdominal pain under investigation',
      doctorNotes: 'Demo: submit a result from the laboratory worklist.',
      isStat: false,
      pregnancySuspected: false,
    });
    order = await orderRepo.save(order);
    for (const [sequenceOrder, department] of [bloodLab, ultrasound].entries()) {
      let step = await stepRepo.findOne({
        where: { visitId: pendingVisit.id, sequenceOrder: sequenceOrder + 1 },
      });
      step ??= stepRepo.create({ visitId: pendingVisit.id, departmentId: department.id });
      Object.assign(step, {
        orderId: order.id,
        departmentId: department.id,
        sequenceOrder: sequenceOrder + 1,
        status: sequenceOrder === 0 ? StepStatus.WAITING : StepStatus.PENDING,
        isReExam: false,
        prerequisiteStepId: undefined,
      });
      await stepRepo.save(step);
    }
  }

  const recallVisit = visits.get('re-exam-calling');
  if (recallVisit) {
    let order = await orderRepo.findOne({ where: { visitId: recallVisit.id } });
    order ??= orderRepo.create({ visitId: recallVisit.id, doctorId: doctor.id });
    Object.assign(order, {
      doctorId: doctor.id,
      workingDiagnosis: 'Completed demo diagnostic workup',
      doctorNotes: 'Demo: results are complete, ready for re-examination.',
      isStat: false,
      pregnancySuspected: false,
    });
    order = await orderRepo.save(order);
    let step = await stepRepo.findOne({ where: { visitId: recallVisit.id, sequenceOrder: 1 } });
    step ??= stepRepo.create({ visitId: recallVisit.id, departmentId: bloodLab.id });
    Object.assign(step, {
      orderId: order.id,
      departmentId: bloodLab.id,
      sequenceOrder: 1,
      status: StepStatus.COMPLETED,
      isReExam: false,
      prerequisiteStepId: undefined,
    });
    step = await stepRepo.save(step);
    let result = await resultRepo.findOne({ where: { stepId: step.id } });
    result ??= resultRepo.create({ stepId: step.id, technicianId: users.get('lab.tech@ezhealthcare.com')!.id });
    Object.assign(result, {
      technicianId: users.get('lab.tech@ezhealthcare.com')!.id,
      serviceName: bloodLab.name,
      quantitativeValues: { WBC: '7.2 x10^9/L', CRP: '3 mg/L' },
      findings: 'Demo result within normal limits.',
      isPanicValue: false,
      approvedAt: new Date(),
    });
    await resultRepo.save(result);
  }

  console.log(`✅ Seeded ${DEMO_VISITS.length} demo workflow visits for ${businessDate}.`);
  return visits;
}

type DemoAppointmentFixture = {
  appointmentCode: string;
  patientEmail: string;
  departmentCode?: string;
  scheduledTime: string;
  status: AppointmentStatus;
  chiefComplaint?: string;
  visitKey?: string;
};

const DEMO_APPOINTMENTS: DemoAppointmentFixture[] = [
  {
    appointmentCode: 'APT-DEMO-001',
    patientEmail: 'patient.appointment.anna@example.com',
    departmentCode: 'P.102',
    scheduledTime: '09:00',
    status: AppointmentStatus.BOOKED,
    chiefComplaint: 'E2E check-in: persistent abdominal discomfort',
  },
  {
    appointmentCode: 'APT-DEMO-002',
    patientEmail: 'patient.appointment.bao@example.com',
    departmentCode: 'P.105',
    scheduledTime: '10:30',
    status: AppointmentStatus.BOOKED,
    chiefComplaint: 'E2E cancellation: scheduled follow-up consultation',
  },
  {
    appointmentCode: 'APT-DEMO-003',
    patientEmail: 'patient.sophia@example.com',
    departmentCode: 'P.102',
    scheduledTime: '08:30',
    status: AppointmentStatus.CHECKED_IN,
    chiefComplaint: 'Scheduled upper abdominal pain assessment',
    visitKey: 'in-examination',
  },
  {
    appointmentCode: 'APT-DEMO-004',
    patientEmail: 'patient.aaron@example.com',
    departmentCode: 'P.102',
    scheduledTime: '11:00',
    status: AppointmentStatus.CANCELLED,
    chiefComplaint: 'Scheduled respiratory symptom assessment',
  },
  {
    appointmentCode: 'APT-DEMO-005',
    patientEmail: 'patient.linda@example.com',
    departmentCode: 'P.102',
    scheduledTime: '08:00',
    status: AppointmentStatus.NO_SHOW,
    chiefComplaint: 'Scheduled headache follow-up',
  },
  {
    appointmentCode: 'APT-DEMO-006',
    patientEmail: 'patient.appointment.chau@example.com',
    departmentCode: 'P.105',
    scheduledTime: '13:30',
    status: AppointmentStatus.BOOKED,
    chiefComplaint: 'E2E second check-in: persistent cough assessment',
  },
];

async function seedDemoAppointments(
  users: Map<string, User>,
  departments: Map<string, Department>,
  visits: Map<string, Visit>,
) {
  const appointmentRepo = dataSource.getRepository(Appointment);
  const receptionist = users.get('reception.clara@ezhealthcare.com');
  const { businessDate } = getBusinessTime();
  if (!receptionist) throw new Error('Demo receptionist account was not created.');

  for (const fixture of DEMO_APPOINTMENTS) {
    const patient = users.get(fixture.patientEmail);
    const department = fixture.departmentCode ? departments.get(fixture.departmentCode) : undefined;
    const visit = fixture.visitKey ? visits.get(fixture.visitKey) : undefined;
    if (!patient || (fixture.departmentCode && !department) || (fixture.visitKey && !visit)) {
      throw new Error(`Demo appointment ${fixture.appointmentCode} is missing a required relation.`);
    }

    let appointment = await appointmentRepo.findOne({
      where: { appointmentCode: fixture.appointmentCode },
    });
    appointment ??= appointmentRepo.create({ appointmentCode: fixture.appointmentCode });
    const scheduledAt = new Date(`${businessDate}T${fixture.scheduledTime}:00.000+07:00`);
    Object.assign(appointment, {
      patientId: patient.id,
      departmentId: department?.id,
      scheduledAt,
      status: fixture.status,
      chiefComplaint: fixture.chiefComplaint,
      checkedInAt: fixture.status === AppointmentStatus.CHECKED_IN ? new Date() : undefined,
      checkedInById: fixture.status === AppointmentStatus.CHECKED_IN ? receptionist.id : undefined,
      visitId: visit?.id,
      cancelledAt: fixture.status === AppointmentStatus.CANCELLED ? new Date() : undefined,
      cancellationReason:
        fixture.status === AppointmentStatus.CANCELLED ? 'Patient requested cancellation.' : undefined,
    });
    await appointmentRepo.save(appointment);
  }
  console.log(`✅ Seeded ${DEMO_APPOINTMENTS.length} reception appointments for ${businessDate}.`);
}

async function runSeed() {
  console.log('🔄 Initializing database connection for English Clinical Seed...');
  await dataSource.initialize();

  const userRepo = dataSource.getRepository(User);
  const deptRepo = dataSource.getRepository(Department);
  const ruleRepo = dataSource.getRepository(TriageRule);
  const configRepo = dataSource.getRepository(SystemConfig);
  const scheduleRepo = dataSource.getRepository(DoctorSchedule);

  // 1. Seed Users
  console.log('--- 1. SEEDING USERS & MEDICAL STAFF ---');
  for (const item of SEED_USERS) {
    const hashedPassword = await bcrypt.hash(item.passwordRaw, BCRYPT_SALT_ROUNDS);
    let user = await userRepo.findOne({ where: { email: item.email } });
    if (!user) {
      user = userRepo.create({
        email: item.email,
        password: hashedPassword,
        name: item.name,
        role: item.role,
        phone: item.phone,
        nationalId: item.nationalId,
        insuranceCardNumber: item.insuranceCardNumber,
        gender: item.gender,
        dateOfBirth: item.dateOfBirth,
        allergies: item.allergies,
        isActive: true,
      });
      await userRepo.save(user);
      console.log(`✅ Created User [${item.role}]: ${item.email}`);
    } else {
      user.name = item.name;
      user.role = item.role;
      user.password = hashedPassword;
      user.phone = item.phone;
      if (item.nationalId) user.nationalId = item.nationalId;
      if (item.insuranceCardNumber) user.insuranceCardNumber = item.insuranceCardNumber;
      if (item.allergies) user.allergies = item.allergies;
      await userRepo.save(user);
      console.log(`ℹ️ Updated User [${item.role}]: ${item.email}`);
    }
  }

  if (process.argv.includes('--auth-only')) {
    await dataSource.destroy();
    console.log('Authentication seed completed for all roles.');
    return;
  }

  // 2. Seed Departments
  console.log('--- 2. SEEDING DEPARTMENTS & CLINICS ---');
  const deptMap = new Map<string, Department>();
  for (const deptData of SEED_DEPARTMENTS) {
    let dept = await deptRepo.findOne({ where: { code: deptData.code } });
    if (!dept) {
      dept = deptRepo.create(deptData);
      await deptRepo.save(dept);
      console.log(`✅ Created Department: ${dept.code} - ${dept.name}`);
    } else {
      dept.name = deptData.name;
      dept.roomType = deptData.roomType;
      dept.floor = deptData.floor;
      dept.avgServiceTimeMin = deptData.avgServiceTimeMin;
      dept.maxQuotaPerSlot = deptData.maxQuotaPerSlot;
      await deptRepo.save(dept);
      console.log(`ℹ️ Updated Department: ${dept.code} - ${dept.name}`);
    }
    deptMap.set(dept.code, dept);
  }

  // 3. Seed Triage Rules
  console.log('--- 3. SEEDING CLINICAL TRIAGE RULES ---');
  for (const r of SEED_RULES) {
    const targetDept = deptMap.get(r.targetDeptCode);
    if (!targetDept) continue;

    let rule = await ruleRepo.findOne({ where: { symptomCode: r.symptomCode } });
    if (!rule) {
      rule = ruleRepo.create({
        symptomCode: r.symptomCode,
        symptomName: r.symptomName,
        targetDepartmentId: targetDept.id,
        isRedFlag: r.isRedFlag,
        contraindicationTags: r.contraindicationTags,
        priorityWeight: r.priorityWeight,
      });
      await ruleRepo.save(rule);
      console.log(`✅ Created Triage Rule: ${r.symptomCode} -> ${r.targetDeptCode}`);
    } else {
      rule.symptomName = r.symptomName;
      rule.targetDepartmentId = targetDept.id;
      rule.isRedFlag = r.isRedFlag;
      rule.contraindicationTags = r.contraindicationTags;
      rule.priorityWeight = r.priorityWeight;
      await ruleRepo.save(rule);
      console.log(`ℹ️ Updated Triage Rule: ${r.symptomCode} -> ${r.targetDeptCode}`);
    }
  }

  // 4. Keep the demo usable across weekends and midnight without manual reseeding.
  console.log('--- 4. SEEDING 14 DAYS OF DOCTOR SCHEDULES ---');
  const doctors = await userRepo.find({ where: { role: Role.DOCTOR } });
  const rooms = [...deptMap.values()].filter((dept) => dept.roomType === 'CONSULTATION');
  const { businessDate } = getBusinessTime();
  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const shiftDate = new Date(`${businessDate}T00:00:00.000Z`);
    shiftDate.setUTCDate(shiftDate.getUTCDate() + dayOffset);
    for (const [index, doctor] of doctors.entries()) {
      const room = rooms[index % rooms.length];
      if (!room) break;
      for (const shiftType of [ShiftType.MORNING, ShiftType.AFTERNOON]) {
        let schedule = await scheduleRepo.findOne({
          where: { doctorId: doctor.id, shiftDate, shiftType },
        });
        schedule ??= scheduleRepo.create({ doctorId: doctor.id, shiftDate, shiftType });
        schedule.departmentId = room.id;
        schedule.maxQuota = room.maxQuotaPerSlot;
        await scheduleRepo.save(schedule);
      }
    }
  }

  // 5. Seed System Config
  console.log('--- 5. SEEDING SYSTEM CONFIGS ---');
  let config = await configRepo.findOne({ where: { configKey: QUEUE_PRIORITY_CONFIG_KEY } });
  if (!config) {
    config = configRepo.create({
      configKey: QUEUE_PRIORITY_CONFIG_KEY,
      configValue: JSON.stringify(QUEUE_PRIORITY_DEFAULTS),
      description: 'Queue priority weighting parameters for recommendation heuristic',
      version: 1,
    });
    await configRepo.save(config);
    console.log(`✅ Created Config: BR-QUEUE-PRIORITY`);
  }

  // 6. Seed a resettable local dataset which exposes every staff workspace to a real case.
  console.log('--- 6. SEEDING ACTOR WORKFLOW DEMO CASES ---');
  const allUsers = await userRepo.find();
  const demoVisits = await seedDemoScenarios(
    new Map(allUsers.map((user) => [user.email, user])),
    deptMap,
  );
  await seedDemoAppointments(new Map(allUsers.map((user) => [user.email, user])), deptMap, demoVisits);

  await dataSource.destroy();
  console.log('🎉 Clinical Foundation Seed completed successfully in English!');
}

runSeed().catch((err) => {
  console.error('❌ Error during seeding:', err);
  process.exit(1);
});
