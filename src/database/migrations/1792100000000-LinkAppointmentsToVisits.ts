import { MigrationInterface, QueryRunner } from 'typeorm';

export class LinkAppointmentsToVisits1792100000000 implements MigrationInterface {
  name = 'LinkAppointmentsToVisits1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "appointments" ADD "visit_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_appointment_visit" FOREIGN KEY ("visit_id") REFERENCES "visits"("id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_appointment_visit" ON "appointments" ("visit_id") WHERE "visit_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uq_appointment_visit"`);
    await queryRunner.query(`ALTER TABLE "appointments" DROP CONSTRAINT "FK_appointment_visit"`);
    await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN "visit_id"`);
  }
}
