import * as bcrypt from 'bcrypt';
import dataSource from '../data-source';
import { User } from '../entities/user.entity';
import { Role } from '../../user/enums/role.enum';
import { Department } from '../../department/entities/department.entity';
import { RoomType } from '../../department/enums/room-type.enum';
import { TriageRule } from '../../triage/entities/triage-rule.entity';
import { SystemConfig } from '../../admin/entities/system-config.entity';

const SEED_USERS = [
  {
    email: 'admin@ezhealthcare.com',
    passwordRaw: 'Admin@123456',
    name: 'Chief Administrator',
    role: Role.ADMIN,
    phone: '+1-555-0100',
  },
  {
    email: 'dr.smith@ezhealthcare.com',
    passwordRaw: 'Doctor@123456',
    name: 'Dr. John Smith, MD',
    role: Role.DOCTOR,
    phone: '+1-555-0101',
  },
  {
    email: 'dr.sarah@ezhealthcare.com',
    passwordRaw: 'Doctor@123456',
    name: 'Dr. Sarah Jenkins, FACS',
    role: Role.DOCTOR,
    phone: '+1-555-0102',
  },
  {
    email: 'nurse.emily@ezhealthcare.com',
    passwordRaw: 'Nurse@123456',
    name: 'Emily Davis, BSN, RN',
    role: Role.NURSE,
    phone: '+1-555-0103',
  },
  {
    email: 'reception.clara@ezhealthcare.com',
    passwordRaw: 'Reception@123456',
    name: 'Clara Oswald',
    role: Role.RECEPTIONIST,
    phone: '+1-555-0104',
  },
  {
    email: 'lab.tech@ezhealthcare.com',
    passwordRaw: 'Lab@123456',
    name: 'Alex Turner, MLS',
    role: Role.LAB_TECHNICIAN,
    phone: '+1-555-0105',
  },
  {
    email: 'er.staff@ezhealthcare.com',
    passwordRaw: 'Emergency@123456',
    name: 'Marcus Vance, EMT-P',
    role: Role.EMERGENCY_STAFF,
    phone: '+1-555-0106',
  },
  {
    email: 'patient.david@example.com',
    passwordRaw: 'Patient@123456',
    name: 'David Miller',
    role: Role.PATIENT,
    nationalId: '079123456789',
    insuranceCardNumber: 'DN4791234567890',
    gender: 'MALE',
    dateOfBirth: new Date('1988-06-12'),
    allergies: ['Penicillin'],
    phone: '+1-555-0199',
  },
  {
    email: 'patient.elizabeth@example.com',
    passwordRaw: 'Patient@123456',
    name: 'Elizabeth Taylor',
    role: Role.PATIENT,
    nationalId: '079987654321',
    insuranceCardNumber: 'GD4799876543210',
    gender: 'FEMALE',
    dateOfBirth: new Date('1944-02-18'), // 82 years old -> Priority
    allergies: ['Aspirin', 'Sulfa'],
    phone: '+1-555-0198',
  },
];

const SEED_DEPARTMENTS = [
  {
    code: 'P.101',
    name: 'Main Reception & Check-in Hall',
    roomType: RoomType.RECEPTION,
    floor: 1,
    avgServiceTimeMin: 5,
    maxQuotaPerSlot: 100,
  },
  {
    code: 'P.102',
    name: 'General Internal Medicine Clinic',
    roomType: RoomType.CONSULTATION,
    floor: 1,
    avgServiceTimeMin: 15,
    maxQuotaPerSlot: 40,
  },
  {
    code: 'P.104',
    name: 'Abdominal Ultrasound Imaging',
    roomType: RoomType.IMAGING,
    floor: 1,
    avgServiceTimeMin: 12,
    maxQuotaPerSlot: 30,
  },
  {
    code: 'P.105',
    name: 'Pulmonology Consultation Clinic',
    roomType: RoomType.CONSULTATION,
    floor: 1,
    avgServiceTimeMin: 15,
    maxQuotaPerSlot: 35,
  },
  {
    code: 'P.108',
    name: 'General Surgery Consultation Clinic',
    roomType: RoomType.CONSULTATION,
    floor: 1,
    avgServiceTimeMin: 15,
    maxQuotaPerSlot: 30,
  },
  {
    code: 'P.201',
    name: 'Hematology & Blood Laboratory',
    roomType: RoomType.LABORATORY,
    floor: 2,
    avgServiceTimeMin: 8,
    maxQuotaPerSlot: 60,
  },
  {
    code: 'P.203',
    name: 'Urinalysis Laboratory',
    roomType: RoomType.LABORATORY,
    floor: 2,
    avgServiceTimeMin: 10,
    maxQuotaPerSlot: 50,
  },
  {
    code: 'P.302',
    name: 'Chest X-Ray Imaging Suite',
    roomType: RoomType.IMAGING,
    floor: 3,
    avgServiceTimeMin: 10,
    maxQuotaPerSlot: 40,
  },
  {
    code: 'P.001',
    name: 'Emergency Resuscitation Unit (STAT)',
    roomType: RoomType.EMERGENCY,
    floor: 1,
    avgServiceTimeMin: 5,
    maxQuotaPerSlot: 20,
  },
];

const SEED_RULES = [
  {
    symptomCode: 'SYM_FEVER_HIGH',
    symptomName: 'High Fever > 38.5°C with Chills',
    targetDeptCode: 'P.201',
    isRedFlag: false,
    priorityWeight: 2,
  },
  {
    symptomCode: 'SYM_ABDOMINAL_PAIN',
    symptomName: 'Persistent Epigastric Pain',
    targetDeptCode: 'P.104',
    isRedFlag: false,
    priorityWeight: 2,
  },
  {
    symptomCode: 'SYM_COUGH_CHEST',
    symptomName: 'Productive Cough with Chest Tightness',
    targetDeptCode: 'P.302',
    isRedFlag: false,
    contraindicationTags: ['PREGNANCY'],
    priorityWeight: 1,
  },
  {
    symptomCode: 'SYM_DYSURIA',
    symptomName: 'Painful Urination and Urinary Frequency',
    targetDeptCode: 'P.203',
    isRedFlag: false,
    priorityWeight: 1,
  },
  {
    symptomCode: 'SYM_CHEST_PAIN_STAT',
    symptomName: 'Acute Crushing Chest Pain, Suspected Myocardial Infarction',
    targetDeptCode: 'P.001',
    isRedFlag: true,
    priorityWeight: 10,
  },
  {
    symptomCode: 'SYM_SEVERE_HYPOXIA',
    symptomName: 'Acute Respiratory Failure with SpO2 < 90%',
    targetDeptCode: 'P.001',
    isRedFlag: true,
    priorityWeight: 10,
  },
];

async function runSeed() {
  console.log('🔄 Initializing database connection for English Clinical Seed...');
  await dataSource.initialize();

  const userRepo = dataSource.getRepository(User);
  const deptRepo = dataSource.getRepository(Department);
  const ruleRepo = dataSource.getRepository(TriageRule);
  const configRepo = dataSource.getRepository(SystemConfig);

  // 1. Seed Users
  console.log('--- 1. SEEDING USERS & MEDICAL STAFF ---');
  for (const item of SEED_USERS) {
    const hashedPassword = await bcrypt.hash(item.passwordRaw, 10);
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

  // 4. Seed System Config
  console.log('--- 4. SEEDING SYSTEM CONFIGS ---');
  let config = await configRepo.findOne({ where: { configKey: 'BR-QUEUE-PRIORITY' } });
  if (!config) {
    config = configRepo.create({
      configKey: 'BR-QUEUE-PRIORITY',
      configValue: JSON.stringify({
        alphaWaitWeight: 0.7,
        betaDistanceWeight: 0.3,
        autoPriorityRecall: true,
      }),
      description: 'Queue priority weighting parameters for recommendation heuristic',
      version: 1,
    });
    await configRepo.save(config);
    console.log(`✅ Created Config: BR-QUEUE-PRIORITY`);
  }

  await dataSource.destroy();
  console.log('🎉 Clinical Foundation Seed completed successfully in English!');
}

runSeed().catch((err) => {
  console.error('❌ Error during seeding:', err);
  process.exit(1);
});
