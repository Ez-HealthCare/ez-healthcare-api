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
import { TriageRule } from '../../triage/entities/triage-rule.entity';
import { SystemConfig } from '../../admin/entities/system-config.entity';

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

  // 4. Seed System Config
  console.log('--- 4. SEEDING SYSTEM CONFIGS ---');
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

  await dataSource.destroy();
  console.log('🎉 Clinical Foundation Seed completed successfully in English!');
}

runSeed().catch((err) => {
  console.error('❌ Error during seeding:', err);
  process.exit(1);
});
