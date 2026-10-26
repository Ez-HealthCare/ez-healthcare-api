import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAppointments1792090000000 implements MigrationInterface {
  name = 'AddAppointments1792090000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."appointments_status_enum" AS ENUM('BOOKED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW')`,
    );
    await queryRunner.query(`
      CREATE TABLE "appointments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "appointment_code" varchar(30) NOT NULL,
        "patient_id" uuid NOT NULL,
        "department_id" uuid,
        "scheduled_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "status" "public"."appointments_status_enum" NOT NULL DEFAULT 'BOOKED',
        "chief_complaint" text,
        "checked_in_at" TIMESTAMP WITH TIME ZONE,
        "checked_in_by_id" uuid,
        "cancelled_at" TIMESTAMP WITH TIME ZONE,
        "cancellation_reason" text,
        CONSTRAINT "PK_appointments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_appointment_patient" FOREIGN KEY ("patient_id") REFERENCES "users"("id"),
        CONSTRAINT "FK_appointment_department" FOREIGN KEY ("department_id") REFERENCES "departments"("id"),
        CONSTRAINT "FK_appointment_checked_in_by" FOREIGN KEY ("checked_in_by_id") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_appointment_code" ON "appointments" ("appointment_code")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointment_reception_queue" ON "appointments" ("scheduled_at", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointment_patient_scheduled" ON "appointments" ("patient_id", "scheduled_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_appointment_patient_scheduled"`);
    await queryRunner.query(`DROP INDEX "public"."idx_appointment_reception_queue"`);
    await queryRunner.query(`DROP INDEX "public"."uq_appointment_code"`);
    await queryRunner.query(`DROP TABLE "appointments"`);
    await queryRunner.query(`DROP TYPE "public"."appointments_status_enum"`);
  }
}
