import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNews2AndAuditLog1791440000000 implements MigrationInterface {
  name = 'AddNews2AndAuditLog1791440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "visit_vitals" ADD "weight_kg" numeric(5,1)`);
    await queryRunner.query(`ALTER TABLE "visit_vitals" ADD "height_cm" numeric(5,1)`);
    await queryRunner.query(
      `ALTER TABLE "visit_vitals" ADD "news2_score" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "visit_vitals" ADD "news2_risk" varchar(20) NOT NULL DEFAULT 'LOW'`,
    );
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "action" varchar(50) NOT NULL, "actor_id" uuid, "actor_role" varchar(50), "target_entity_type" varchar(50) NOT NULL, "target_entity_id" uuid NOT NULL, "metadata" jsonb, "ip_address" inet, "created_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "idx_audit_logs_action" ON "audit_logs" ("action")`);
    await queryRunner.query(`CREATE INDEX "idx_audit_logs_actor_id" ON "audit_logs" ("actor_id")`);
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_target" ON "audit_logs" ("target_entity_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_audit_logs_target"`);
    await queryRunner.query(`DROP INDEX "idx_audit_logs_actor_id"`);
    await queryRunner.query(`DROP INDEX "idx_audit_logs_action"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`ALTER TABLE "visit_vitals" DROP COLUMN "news2_risk"`);
    await queryRunner.query(`ALTER TABLE "visit_vitals" DROP COLUMN "news2_score"`);
    await queryRunner.query(`ALTER TABLE "visit_vitals" DROP COLUMN "height_cm"`);
    await queryRunner.query(`ALTER TABLE "visit_vitals" DROP COLUMN "weight_kg"`);
  }
}
