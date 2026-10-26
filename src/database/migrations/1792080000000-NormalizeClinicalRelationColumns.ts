import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The initial schema kept both camelCase relation columns and the newer
 * snake_case columns. Phase B normalized visits, vitals and schedules, but
 * omitted the remaining clinical relation tables. The entities use
 * snake_case, so the legacy NOT NULL columns made orders, results and
 * prescriptions impossible to save.
 */
export class NormalizeClinicalRelationColumns1792080000000 implements MigrationInterface {
  name = 'NormalizeClinicalRelationColumns1792080000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "visit_orders"
       SET "visit_id" = COALESCE("visit_id", "visitId"),
           "doctor_id" = COALESCE("doctor_id", "doctorId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_orders"
       ALTER COLUMN "visit_id" SET NOT NULL,
       ALTER COLUMN "doctor_id" SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "visit_orders" DROP COLUMN "visitId", DROP COLUMN "doctorId"`);

    await queryRunner.query(
      `UPDATE "visit_steps"
       SET "visit_id" = COALESCE("visit_id", "visitId"),
           "order_id" = COALESCE("order_id", "orderId"),
           "department_id" = COALESCE("department_id", "departmentId"),
           "prerequisite_step_id" = COALESCE("prerequisite_step_id", "prerequisiteStepId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_steps"
       ALTER COLUMN "visit_id" SET NOT NULL,
       ALTER COLUMN "department_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_steps"
       DROP COLUMN "visitId", DROP COLUMN "orderId", DROP COLUMN "departmentId", DROP COLUMN "prerequisiteStepId"`,
    );

    await queryRunner.query(
      `UPDATE "paraclinical_results"
       SET "step_id" = COALESCE("step_id", "stepId"),
           "technician_id" = COALESCE("technician_id", "technicianId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "paraclinical_results"
       ALTER COLUMN "step_id" SET NOT NULL,
       ALTER COLUMN "technician_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "paraclinical_results" DROP COLUMN "stepId", DROP COLUMN "technicianId"`,
    );

    await queryRunner.query(
      `UPDATE "prescriptions"
       SET "visit_id" = COALESCE("visit_id", "visitId"),
           "doctor_id" = COALESCE("doctor_id", "doctorId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions"
       ALTER COLUMN "visit_id" SET NOT NULL,
       ALTER COLUMN "doctor_id" SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "visitId", DROP COLUMN "doctorId"`);

    await queryRunner.query(
      `UPDATE "prescription_items"
       SET "prescription_id" = COALESCE("prescription_id", "prescriptionId")`,
    );
    await queryRunner.query(`ALTER TABLE "prescription_items" ALTER COLUMN "prescription_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "prescription_items" DROP COLUMN "prescriptionId"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "prescription_items" ADD "prescriptionId" uuid`);
    await queryRunner.query(`UPDATE "prescription_items" SET "prescriptionId" = "prescription_id"`);
    await queryRunner.query(`ALTER TABLE "prescription_items" ALTER COLUMN "prescriptionId" SET NOT NULL`);

    await queryRunner.query(`ALTER TABLE "prescriptions" ADD "visitId" uuid, ADD "doctorId" uuid`);
    await queryRunner.query(
      `UPDATE "prescriptions" SET "visitId" = "visit_id", "doctorId" = "doctor_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ALTER COLUMN "visitId" SET NOT NULL, ALTER COLUMN "doctorId" SET NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "paraclinical_results" ADD "stepId" uuid, ADD "technicianId" uuid`,
    );
    await queryRunner.query(
      `UPDATE "paraclinical_results" SET "stepId" = "step_id", "technicianId" = "technician_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "paraclinical_results" ALTER COLUMN "stepId" SET NOT NULL, ALTER COLUMN "technicianId" SET NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "visit_steps"
       ADD "visitId" uuid, ADD "orderId" uuid, ADD "departmentId" uuid, ADD "prerequisiteStepId" uuid`,
    );
    await queryRunner.query(
      `UPDATE "visit_steps"
       SET "visitId" = "visit_id", "orderId" = "order_id", "departmentId" = "department_id", "prerequisiteStepId" = "prerequisite_step_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_steps" ALTER COLUMN "visitId" SET NOT NULL, ALTER COLUMN "departmentId" SET NOT NULL`,
    );

    await queryRunner.query(`ALTER TABLE "visit_orders" ADD "visitId" uuid, ADD "doctorId" uuid`);
    await queryRunner.query(`UPDATE "visit_orders" SET "visitId" = "visit_id", "doctorId" = "doctor_id"`);
    await queryRunner.query(
      `ALTER TABLE "visit_orders" ALTER COLUMN "visitId" SET NOT NULL, ALTER COLUMN "doctorId" SET NOT NULL`,
    );
  }
}
