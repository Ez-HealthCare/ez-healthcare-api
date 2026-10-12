import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitClinicalDatabase1791439990774 implements MigrationInterface {
  name = 'InitClinicalDatabase1791439990774';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum" AS ENUM('PATIENT', 'RECEPTIONIST', 'NURSE', 'DOCTOR', 'LAB_TECHNICIAN', 'EMERGENCY_STAFF', 'ADMIN')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "email" character varying(255) NOT NULL, "phone" character varying(30), "password" character varying(255), "name" character varying(255), "role" "public"."users_role_enum" NOT NULL DEFAULT 'PATIENT', "nationalId" character varying(20), "insuranceCardNumber" character varying(30), "gender" character varying(10), "dateOfBirth" date, "allergies" text array, "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "UQ_523469f4c23cb1df14fb0d86835" UNIQUE ("nationalId"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "idx_users_email" ON "users"  ("email") `);
    await queryRunner.query(`CREATE INDEX "idx_users_national_id" ON "users"  ("nationalId") `);
    await queryRunner.query(
      `CREATE TABLE "system_configs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "configKey" character varying(100) NOT NULL, "configValue" text NOT NULL, "description" text, "version" integer NOT NULL DEFAULT '1', CONSTRAINT "UQ_629779e823a9cc065bf964a2415" UNIQUE ("configKey"), CONSTRAINT "PK_29ac548e654c799fd885e1b9b71" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_system_configs_key" ON "system_configs"  ("configKey") `,
    );
    await queryRunner.query(
      `CREATE TABLE "patient_otps" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "email" character varying(255) NOT NULL, "otpCode" character varying(10) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "failedAttempts" integer NOT NULL DEFAULT '0', "isUsed" boolean NOT NULL DEFAULT false, "lockedUntil" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_2bdd6dab8c6373451e3d7e4a974" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "idx_patient_otps_email" ON "patient_otps"  ("email") `);
    await queryRunner.query(
      `CREATE TYPE "public"."departments_roomtype_enum" AS ENUM('RECEPTION', 'TRIAGE', 'CONSULTATION', 'LABORATORY', 'IMAGING', 'EMERGENCY')`,
    );
    await queryRunner.query(
      `CREATE TABLE "departments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "code" character varying(50) NOT NULL, "name" character varying(255) NOT NULL, "roomType" "public"."departments_roomtype_enum" NOT NULL DEFAULT 'CONSULTATION', "floor" integer NOT NULL DEFAULT '1', "avgServiceTimeMin" integer NOT NULL DEFAULT '15', "maxQuotaPerSlot" integer NOT NULL DEFAULT '40', "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "UQ_91fddbe23e927e1e525c152baa3" UNIQUE ("code"), CONSTRAINT "PK_839517a681a86bb84cbcc6a1e9d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "idx_departments_code" ON "departments"  ("code") `);
    await queryRunner.query(
      `CREATE TYPE "public"."doctor_schedules_shifttype_enum" AS ENUM('MORNING', 'AFTERNOON')`,
    );
    await queryRunner.query(
      `CREATE TABLE "doctor_schedules" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "doctorId" uuid NOT NULL, "departmentId" uuid NOT NULL, "shiftDate" date NOT NULL, "shiftType" "public"."doctor_schedules_shifttype_enum" NOT NULL DEFAULT 'MORNING', "slotDurationMin" integer NOT NULL DEFAULT '15', "maxQuota" integer NOT NULL DEFAULT '40', "allocatedCount" integer NOT NULL DEFAULT '0', "doctor_id" uuid, "department_id" uuid, CONSTRAINT "PK_a1cab57bc0a680b50d06930b377" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_doctor_schedule_unique" ON "doctor_schedules"  ("doctorId", "shiftDate", "shiftType") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."visit_steps_status_enum" AS ENUM('PENDING', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "visit_steps" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "visitId" uuid NOT NULL, "orderId" uuid, "departmentId" uuid NOT NULL, "sequenceOrder" integer NOT NULL DEFAULT '1', "prerequisiteStepId" uuid, "status" "public"."visit_steps_status_enum" NOT NULL DEFAULT 'PENDING', "isReExam" boolean NOT NULL DEFAULT false, "visit_id" uuid, "order_id" uuid, "department_id" uuid, "prerequisite_step_id" uuid, CONSTRAINT "PK_fce0286eaf882d07278d7c9e1a4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_visit_steps_visit_id" ON "visit_steps"  ("visitId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "paraclinical_results" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "stepId" uuid NOT NULL, "technicianId" uuid NOT NULL, "serviceName" character varying(255) NOT NULL, "resultSummary" text, "quantitativeValues" jsonb, "findings" text, "dicomImageUrls" text array, "isPanicValue" boolean NOT NULL DEFAULT false, "panicAlertDetails" text, "approvedAt" TIMESTAMP WITH TIME ZONE, "step_id" uuid, "technician_id" uuid, CONSTRAINT "REL_b90b6c568d32c3083743e4506b" UNIQUE ("step_id"), CONSTRAINT "PK_d4a919fc4964154db716f8ae313" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_paraclinical_step_id" ON "paraclinical_results"  ("stepId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "prescription_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "prescriptionId" uuid NOT NULL, "medicationName" character varying(255) NOT NULL, "dosage" character varying(100) NOT NULL, "route" character varying(50) NOT NULL DEFAULT 'ORAL', "frequency" character varying(100) NOT NULL, "durationDays" integer NOT NULL DEFAULT '7', "quantity" integer NOT NULL DEFAULT '1', "instructions" text, "prescription_id" uuid, CONSTRAINT "PK_6216831f49afc381b3934c9672c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_prescription_items_prescription_id" ON "prescription_items"  ("prescriptionId") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."visits_status_enum" AS ENUM('HALL_WAITING', 'RECEPTION_VERIFIED', 'TRIAGE_PENDING', 'CLINIC_WAITING', 'IN_EXAMINATION', 'PARACLINICAL_PENDING', 'RE_EXAM_CALLING', 'COMPLETED', 'EMERGENCY_DISPATCHED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "visits" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "patientId" uuid NOT NULL, "hallTicketNumber" character varying(30) NOT NULL, "clinicTicketNumber" character varying(30), "receptionistId" uuid, "currentDoctorId" uuid, "initialDepartmentId" uuid, "currentDepartmentId" uuid, "status" "public"."visits_status_enum" NOT NULL DEFAULT 'HALL_WAITING', "isPriority" boolean NOT NULL DEFAULT false, "priorityReason" character varying(255), "chiefComplaint" text, "symptomOnset" character varying(100), "symptomDuration" character varying(100), "symptomSeverity" character varying(50), "isVerified" boolean NOT NULL DEFAULT false, "patient_id" uuid, "receptionist_id" uuid, "current_doctor_id" uuid, "initial_department_id" uuid, "current_department_id" uuid, CONSTRAINT "PK_0b0b322289a41015c6ea4e8bf30" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_visits_hall_ticket" ON "visits"  ("hallTicketNumber") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_visits_clinic_ticket" ON "visits"  ("clinicTicketNumber") `,
    );
    await queryRunner.query(`CREATE INDEX "idx_visits_status" ON "visits"  ("status") `);
    await queryRunner.query(
      `CREATE TABLE "prescriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "visitId" uuid NOT NULL, "doctorId" uuid NOT NULL, "icd10Code" character varying(20) NOT NULL, "icd10Name" character varying(255) NOT NULL, "notes" text, "revisitDate" date, "digitalSignature" character varying(255), "visit_id" uuid, "doctor_id" uuid, CONSTRAINT "REL_a6578313f14ea989bb422597ff" UNIQUE ("visit_id"), CONSTRAINT "PK_097b2cc2f2b7e56825468188503" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_prescriptions_visit_id" ON "prescriptions"  ("visitId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "triage_rules" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "symptomCode" character varying(50) NOT NULL, "symptomName" character varying(255) NOT NULL, "targetDepartmentId" uuid NOT NULL, "isRedFlag" boolean NOT NULL DEFAULT false, "contraindicationTags" text array, "priorityWeight" integer NOT NULL DEFAULT '1', "target_department_id" uuid, CONSTRAINT "UQ_f5596f9ea11097f7e905a354bcc" UNIQUE ("symptomCode"), CONSTRAINT "PK_59dac7daefa93c2aab2fe5b633b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_triage_rules_symptom_code" ON "triage_rules"  ("symptomCode") `,
    );
    await queryRunner.query(
      `CREATE TABLE "visit_orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "visitId" uuid NOT NULL, "doctorId" uuid NOT NULL, "workingDiagnosis" text, "isStat" boolean NOT NULL DEFAULT false, "pregnancySuspected" boolean NOT NULL DEFAULT false, "doctorNotes" text, "visit_id" uuid, "doctor_id" uuid, CONSTRAINT "REL_68abdfd4159090b0f4f1f7d214" UNIQUE ("visit_id"), CONSTRAINT "PK_0ac34af8ff9ead3d827f8543700" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_visit_orders_visit_id" ON "visit_orders"  ("visitId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "visit_vitals" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "visitId" uuid NOT NULL, "nurseId" uuid NOT NULL, "bloodPressureSystolic" integer NOT NULL, "bloodPressureDiastolic" integer NOT NULL, "heartRate" integer NOT NULL, "temperature" numeric(4,1) NOT NULL, "spo2" numeric(4,1) NOT NULL, "respiratoryRate" integer NOT NULL, "isRedFlag" boolean NOT NULL DEFAULT false, "redFlagReason" character varying(255), "notes" text, "visit_id" uuid, "nurse_id" uuid, CONSTRAINT "REL_8603560a5324d3b484467bc779" UNIQUE ("visit_id"), CONSTRAINT "PK_6647554c1625d7663d0aa15846c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_visit_vitals_visit_id" ON "visit_vitals"  ("visitId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_schedules" ADD CONSTRAINT "FK_a9562c0e3b99e62425d3356c88b" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_schedules" ADD CONSTRAINT "FK_0d587cbe9c4492725fe0c31ee8a" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_steps" ADD CONSTRAINT "FK_67fc54827639c7487f08ac7319d" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_steps" ADD CONSTRAINT "FK_2210cf2e88796a25b043a682fee" FOREIGN KEY ("order_id") REFERENCES "visit_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_steps" ADD CONSTRAINT "FK_d41d63fc66827fc5dd6600bc294" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_steps" ADD CONSTRAINT "FK_1517e24db762a897aca055151a3" FOREIGN KEY ("prerequisite_step_id") REFERENCES "visit_steps"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "paraclinical_results" ADD CONSTRAINT "FK_b90b6c568d32c3083743e4506ba" FOREIGN KEY ("step_id") REFERENCES "visit_steps"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "paraclinical_results" ADD CONSTRAINT "FK_7f7c0ccea4ebe26e867e4db50a8" FOREIGN KEY ("technician_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescription_items" ADD CONSTRAINT "FK_a603d92d4a8459db5fbe45a4aea" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "FK_5054db93135a6d966fd3939caa6" FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "FK_df7157fc918facb0fce26ef97bc" FOREIGN KEY ("receptionist_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "FK_58a0525bd370cb21c245466bb38" FOREIGN KEY ("current_doctor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "FK_972c82b1201afa9f2f4694595e0" FOREIGN KEY ("initial_department_id") REFERENCES "departments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "FK_61fd157e41aeddc52a1003d3289" FOREIGN KEY ("current_department_id") REFERENCES "departments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD CONSTRAINT "FK_a6578313f14ea989bb422597ff8" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD CONSTRAINT "FK_2d6a1941bd705056030c2b9e07d" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "triage_rules" ADD CONSTRAINT "FK_029c29e52fc62fe9fb76b7c9385" FOREIGN KEY ("target_department_id") REFERENCES "departments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_orders" ADD CONSTRAINT "FK_68abdfd4159090b0f4f1f7d214c" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_orders" ADD CONSTRAINT "FK_d7466ae952adae1ec31610c7780" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_vitals" ADD CONSTRAINT "FK_8603560a5324d3b484467bc779e" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_vitals" ADD CONSTRAINT "FK_820c4173678b982d099a6a90057" FOREIGN KEY ("nurse_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "visit_vitals" DROP CONSTRAINT "FK_820c4173678b982d099a6a90057"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_vitals" DROP CONSTRAINT "FK_8603560a5324d3b484467bc779e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_orders" DROP CONSTRAINT "FK_d7466ae952adae1ec31610c7780"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_orders" DROP CONSTRAINT "FK_68abdfd4159090b0f4f1f7d214c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "triage_rules" DROP CONSTRAINT "FK_029c29e52fc62fe9fb76b7c9385"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" DROP CONSTRAINT "FK_2d6a1941bd705056030c2b9e07d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" DROP CONSTRAINT "FK_a6578313f14ea989bb422597ff8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "FK_61fd157e41aeddc52a1003d3289"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "FK_972c82b1201afa9f2f4694595e0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "FK_58a0525bd370cb21c245466bb38"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "FK_df7157fc918facb0fce26ef97bc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "FK_5054db93135a6d966fd3939caa6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescription_items" DROP CONSTRAINT "FK_a603d92d4a8459db5fbe45a4aea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "paraclinical_results" DROP CONSTRAINT "FK_7f7c0ccea4ebe26e867e4db50a8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "paraclinical_results" DROP CONSTRAINT "FK_b90b6c568d32c3083743e4506ba"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_steps" DROP CONSTRAINT "FK_1517e24db762a897aca055151a3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_steps" DROP CONSTRAINT "FK_d41d63fc66827fc5dd6600bc294"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_steps" DROP CONSTRAINT "FK_2210cf2e88796a25b043a682fee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_steps" DROP CONSTRAINT "FK_67fc54827639c7487f08ac7319d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_schedules" DROP CONSTRAINT "FK_0d587cbe9c4492725fe0c31ee8a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_schedules" DROP CONSTRAINT "FK_a9562c0e3b99e62425d3356c88b"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_visit_vitals_visit_id"`);
    await queryRunner.query(`DROP TABLE "visit_vitals"`);
    await queryRunner.query(`DROP INDEX "public"."idx_visit_orders_visit_id"`);
    await queryRunner.query(`DROP TABLE "visit_orders"`);
    await queryRunner.query(`DROP INDEX "public"."idx_triage_rules_symptom_code"`);
    await queryRunner.query(`DROP TABLE "triage_rules"`);
    await queryRunner.query(`DROP INDEX "public"."idx_prescriptions_visit_id"`);
    await queryRunner.query(`DROP TABLE "prescriptions"`);
    await queryRunner.query(`DROP INDEX "public"."idx_visits_status"`);
    await queryRunner.query(`DROP INDEX "public"."idx_visits_clinic_ticket"`);
    await queryRunner.query(`DROP INDEX "public"."idx_visits_hall_ticket"`);
    await queryRunner.query(`DROP TABLE "visits"`);
    await queryRunner.query(`DROP TYPE "public"."visits_status_enum"`);
    await queryRunner.query(`DROP INDEX "public"."idx_prescription_items_prescription_id"`);
    await queryRunner.query(`DROP TABLE "prescription_items"`);
    await queryRunner.query(`DROP INDEX "public"."idx_paraclinical_step_id"`);
    await queryRunner.query(`DROP TABLE "paraclinical_results"`);
    await queryRunner.query(`DROP INDEX "public"."idx_visit_steps_visit_id"`);
    await queryRunner.query(`DROP TABLE "visit_steps"`);
    await queryRunner.query(`DROP TYPE "public"."visit_steps_status_enum"`);
    await queryRunner.query(`DROP INDEX "public"."idx_doctor_schedule_unique"`);
    await queryRunner.query(`DROP TABLE "doctor_schedules"`);
    await queryRunner.query(`DROP TYPE "public"."doctor_schedules_shifttype_enum"`);
    await queryRunner.query(`DROP INDEX "public"."idx_departments_code"`);
    await queryRunner.query(`DROP TABLE "departments"`);
    await queryRunner.query(`DROP TYPE "public"."departments_roomtype_enum"`);
    await queryRunner.query(`DROP INDEX "public"."idx_patient_otps_email"`);
    await queryRunner.query(`DROP TABLE "patient_otps"`);
    await queryRunner.query(`DROP INDEX "public"."idx_system_configs_key"`);
    await queryRunner.query(`DROP TABLE "system_configs"`);
    await queryRunner.query(`DROP INDEX "public"."idx_users_national_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_users_email"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
  }
}
