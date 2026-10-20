import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPhaseBQueues1792060000000 implements MigrationInterface {
  name = 'AddPhaseBQueues1792060000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."visits_status_enum" ADD VALUE IF NOT EXISTS 'CLINIC_CALLED'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."visits_status_enum" ADD VALUE IF NOT EXISTS 'TEMPORARILY_ABSENT'`,
    );

    await queryRunner.query(
      `UPDATE "visits" SET "patient_id" = COALESCE("patient_id", "patientId")`,
    );
    await queryRunner.query(
      `UPDATE "visits" SET "receptionist_id" = COALESCE("receptionist_id", "receptionistId"), "current_doctor_id" = COALESCE("current_doctor_id", "currentDoctorId"), "initial_department_id" = COALESCE("initial_department_id", "initialDepartmentId"), "current_department_id" = COALESCE("current_department_id", "currentDepartmentId")`,
    );
    await queryRunner.query(`ALTER TABLE "visits" ALTER COLUMN "patient_id" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "visits" DROP COLUMN "patientId", DROP COLUMN "receptionistId", DROP COLUMN "currentDoctorId", DROP COLUMN "initialDepartmentId", DROP COLUMN "currentDepartmentId"`,
    );

    await queryRunner.query(
      `UPDATE "visit_vitals" SET "visit_id" = COALESCE("visit_id", "visitId"), "nurse_id" = COALESCE("nurse_id", "nurseId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_vitals" ALTER COLUMN "visit_id" SET NOT NULL, ALTER COLUMN "nurse_id" SET NOT NULL`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_visit_vitals_visit_id"`);
    await queryRunner.query(
      `ALTER TABLE "visit_vitals" DROP COLUMN "visitId", DROP COLUMN "nurseId"`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_visit_vitals_visit_id" ON "visit_vitals" ("visit_id")`,
    );

    await queryRunner.query(
      `UPDATE "doctor_schedules" SET "doctor_id" = COALESCE("doctor_id", "doctorId"), "department_id" = COALESCE("department_id", "departmentId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_schedules" ALTER COLUMN "doctor_id" SET NOT NULL, ALTER COLUMN "department_id" SET NOT NULL`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_doctor_schedule_unique"`);
    await queryRunner.query(
      `ALTER TABLE "doctor_schedules" DROP COLUMN "doctorId", DROP COLUMN "departmentId"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_doctor_schedule_unique" ON "doctor_schedules" ("doctor_id", "shiftDate", "shiftType")`,
    );

    await queryRunner.query(
      `UPDATE "triage_rules" SET "target_department_id" = COALESCE("target_department_id", "targetDepartmentId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "triage_rules" ALTER COLUMN "target_department_id" SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "triage_rules" DROP COLUMN "targetDepartmentId"`);

    await queryRunner.query(
      `ALTER TABLE "visits" ADD "hall_reissue_count" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD "intake_completed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."queue_ticket_kind_enum" AS ENUM('HALL', 'CLINIC')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."queue_ticket_status_enum" AS ENUM('ACTIVE', 'PAUSED', 'COMPLETED', 'SUPERSEDED', 'EXPIRED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "queue_counters" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "kind" "public"."queue_ticket_kind_enum" NOT NULL, "scope_key" varchar(100) NOT NULL, "business_date" date NOT NULL, "last_issued" integer NOT NULL DEFAULT 0, CONSTRAINT "PK_queue_counters" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_queue_counter_scope_day" ON "queue_counters" ("kind", "scope_key", "business_date")`,
    );
    await queryRunner.query(
      `CREATE TABLE "queue_tickets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "visit_id" uuid NOT NULL, "kind" "public"."queue_ticket_kind_enum" NOT NULL, "scope_key" varchar(100) NOT NULL, "business_date" date NOT NULL, "sequence" integer NOT NULL, "display_number" varchar(30) NOT NULL, "status" "public"."queue_ticket_status_enum" NOT NULL DEFAULT 'ACTIVE', "issued_by_id" uuid, "reissue_of_id" uuid, "reissue_reason" text, "idempotency_key" varchar(100) NOT NULL, "queued_at" TIMESTAMP WITH TIME ZONE NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "call_attempts" integer NOT NULL DEFAULT 0, "last_called_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_queue_tickets" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_queue_ticket_sequence" ON "queue_tickets" ("kind", "scope_key", "business_date", "sequence")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_queue_ticket_idempotency" ON "queue_tickets" ("idempotency_key")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_queue_ticket_visit_kind" ON "queue_tickets" ("visit_id", "kind")`,
    );
    await queryRunner.query(
      `ALTER TABLE "queue_tickets" ADD CONSTRAINT "FK_queue_ticket_visit" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "queue_tickets" ADD CONSTRAINT "FK_queue_ticket_issuer" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "queue_tickets" ADD CONSTRAINT "FK_queue_ticket_reissue" FOREIGN KEY ("reissue_of_id") REFERENCES "queue_tickets"("id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "visit_id" uuid, "type" varchar(50) NOT NULL, "title" varchar(255) NOT NULL, "message" text NOT NULL, "metadata" jsonb, "read_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_notifications" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_notification_user_created" ON "notifications" ("user_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_notification_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_notification_visit" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP TABLE "queue_tickets"`);
    await queryRunner.query(`DROP TABLE "queue_counters"`);
    await queryRunner.query(`DROP TYPE "public"."queue_ticket_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."queue_ticket_kind_enum"`);
    await queryRunner.query(`ALTER TABLE "visits" DROP COLUMN "intake_completed_at"`);
    await queryRunner.query(`ALTER TABLE "visits" DROP COLUMN "hall_reissue_count"`);

    await queryRunner.query(
      `ALTER TABLE "visits" ADD "patientId" uuid, ADD "receptionistId" uuid, ADD "currentDoctorId" uuid, ADD "initialDepartmentId" uuid, ADD "currentDepartmentId" uuid`,
    );
    await queryRunner.query(
      `UPDATE "visits" SET "patientId" = "patient_id", "receptionistId" = "receptionist_id", "currentDoctorId" = "current_doctor_id", "initialDepartmentId" = "initial_department_id", "currentDepartmentId" = "current_department_id"`,
    );
    await queryRunner.query(`ALTER TABLE "visits" ALTER COLUMN "patientId" SET NOT NULL`);

    await queryRunner.query(`ALTER TABLE "visit_vitals" ADD "visitId" uuid, ADD "nurseId" uuid`);
    await queryRunner.query(
      `UPDATE "visit_vitals" SET "visitId" = "visit_id", "nurseId" = "nurse_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_vitals" ALTER COLUMN "visitId" SET NOT NULL, ALTER COLUMN "nurseId" SET NOT NULL`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_visit_vitals_visit_id"`);
    await queryRunner.query(
      `CREATE INDEX "idx_visit_vitals_visit_id" ON "visit_vitals" ("visitId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "doctor_schedules" ADD "doctorId" uuid, ADD "departmentId" uuid`,
    );
    await queryRunner.query(
      `UPDATE "doctor_schedules" SET "doctorId" = "doctor_id", "departmentId" = "department_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_schedules" ALTER COLUMN "doctorId" SET NOT NULL, ALTER COLUMN "departmentId" SET NOT NULL`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_doctor_schedule_unique"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_doctor_schedule_unique" ON "doctor_schedules" ("doctorId", "shiftDate", "shiftType")`,
    );

    await queryRunner.query(`ALTER TABLE "triage_rules" ADD "targetDepartmentId" uuid`);
    await queryRunner.query(
      `UPDATE "triage_rules" SET "targetDepartmentId" = "target_department_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "triage_rules" ALTER COLUMN "targetDepartmentId" SET NOT NULL`,
    );

    await queryRunner.query(
      `UPDATE "visits" SET "status" = 'CLINIC_WAITING' WHERE "status" IN ('CLINIC_CALLED', 'TEMPORARILY_ABSENT')`,
    );
    await queryRunner.query(`ALTER TABLE "visits" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TYPE "public"."visits_status_enum" RENAME TO "visits_status_enum_phase_b"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."visits_status_enum" AS ENUM('HALL_WAITING', 'RECEPTION_VERIFIED', 'TRIAGE_PENDING', 'CLINIC_WAITING', 'IN_EXAMINATION', 'PARACLINICAL_PENDING', 'RE_EXAM_CALLING', 'COMPLETED', 'EMERGENCY_DISPATCHED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ALTER COLUMN "status" TYPE "public"."visits_status_enum" USING "status"::text::"public"."visits_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ALTER COLUMN "status" SET DEFAULT 'HALL_WAITING'`,
    );
    await queryRunner.query(`DROP TYPE "public"."visits_status_enum_phase_b"`);
  }
}
