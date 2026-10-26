import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReceptionRequests1792110000000 implements MigrationInterface {
  name = 'AddReceptionRequests1792110000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."reception_requests_status_enum" AS ENUM('DRAFT', 'RECEPTION_PENDING', 'CONVERTED_TO_VISIT', 'CANCELLED', 'REJECTED', 'EXPIRED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "reception_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "patient_id" uuid NOT NULL,
        "status" "public"."reception_requests_status_enum" NOT NULL DEFAULT 'DRAFT',
        "business_date" date,
        "expires_at" TIMESTAMP WITH TIME ZONE,
        "chief_complaint" text,
        "symptom_codes" text array,
        "symptom_onset" character varying(100),
        "symptom_duration" character varying(100),
        "symptom_severity" character varying(50),
        "patient_note" text,
        "requested_service_note" text,
        "submitted_at" TIMESTAMP WITH TIME ZONE,
        "processed_at" TIMESTAMP WITH TIME ZONE,
        "processed_by_id" uuid,
        "rejection_reason" text,
        "visit_id" uuid,
        CONSTRAINT "PK_reception_requests_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_reception_requests_patient" FOREIGN KEY ("patient_id") REFERENCES "users"("id"),
        CONSTRAINT "FK_reception_requests_processed_by" FOREIGN KEY ("processed_by_id") REFERENCES "users"("id"),
        CONSTRAINT "FK_reception_requests_visit" FOREIGN KEY ("visit_id") REFERENCES "visits"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_reception_requests_patient_status" ON "reception_requests" ("patient_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_reception_requests_status_created" ON "reception_requests" ("status", "created_at")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_reception_requests_active_patient" ON "reception_requests" ("patient_id") WHERE "status" IN ('DRAFT', 'RECEPTION_PENDING')`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_reception_requests_visit" ON "reception_requests" ("visit_id") WHERE "visit_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uq_reception_requests_visit"`);
    await queryRunner.query(`DROP INDEX "public"."uq_reception_requests_active_patient"`);
    await queryRunner.query(`DROP INDEX "public"."idx_reception_requests_status_created"`);
    await queryRunner.query(`DROP INDEX "public"."idx_reception_requests_patient_status"`);
    await queryRunner.query(`DROP TABLE "reception_requests"`);
    await queryRunner.query(`DROP TYPE "public"."reception_requests_status_enum"`);
  }
}
