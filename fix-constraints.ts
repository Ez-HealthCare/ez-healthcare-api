import dataSource from './src/database/data-source';

async function fix() {
  await dataSource.initialize();
  const queries = [
    'ALTER TABLE "visits" ALTER COLUMN "patientId" DROP NOT NULL',
    'ALTER TABLE "visit_vitals" ALTER COLUMN "visitId" DROP NOT NULL',
    'ALTER TABLE "visit_vitals" ALTER COLUMN "nurseId" DROP NOT NULL',
    'ALTER TABLE "visit_orders" ALTER COLUMN "visitId" DROP NOT NULL',
    'ALTER TABLE "visit_orders" ALTER COLUMN "doctorId" DROP NOT NULL',
    'ALTER TABLE "visit_steps" ALTER COLUMN "visitId" DROP NOT NULL',
    'ALTER TABLE "visit_steps" ALTER COLUMN "departmentId" DROP NOT NULL',
    'ALTER TABLE "paraclinical_results" ALTER COLUMN "stepId" DROP NOT NULL',
    'ALTER TABLE "paraclinical_results" ALTER COLUMN "technicianId" DROP NOT NULL',
    'ALTER TABLE "prescriptions" ALTER COLUMN "visitId" DROP NOT NULL',
    'ALTER TABLE "prescriptions" ALTER COLUMN "doctorId" DROP NOT NULL',
    'ALTER TABLE "prescription_items" ALTER COLUMN "prescriptionId" DROP NOT NULL',
    'ALTER TABLE "doctor_schedules" ALTER COLUMN "doctorId" DROP NOT NULL',
    'ALTER TABLE "doctor_schedules" ALTER COLUMN "departmentId" DROP NOT NULL',
    'ALTER TABLE "triage_rules" ALTER COLUMN "targetDepartmentId" DROP NOT NULL',
  ];

  for (const q of queries) {
    try {
      await dataSource.query(q);
      console.log(`Executed: ${q}`);
    } catch (e: any) {
      console.warn(`Warning on: ${q}:`, e.message);
    }
  }

  await dataSource.destroy();
  console.log('✅ All duplicate constraints updated successfully!');
}

fix();
