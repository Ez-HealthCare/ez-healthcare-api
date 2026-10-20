import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenPhaseBQueues1792070000000 implements MigrationInterface {
  name = 'HardenPhaseBQueues1792070000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "queue_tickets" ADD "operation" varchar(40)`);
    await queryRunner.query(`ALTER TABLE "queue_tickets" ADD "request_fingerprint" char(64)`);
    await queryRunner.query(`
      WITH ranked AS (
        SELECT id,
               row_number() OVER (
                 PARTITION BY visit_id, kind
                 ORDER BY queued_at DESC, created_at DESC, id DESC
               ) AS position
        FROM queue_tickets
        WHERE status IN ('ACTIVE', 'PAUSED')
      )
      UPDATE queue_tickets AS ticket
      SET status = 'SUPERSEDED',
          reissue_reason = COALESCE(ticket.reissue_reason, 'Normalized by Phase C migration')
      FROM ranked
      WHERE ticket.id = ranked.id AND ranked.position > 1
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_queue_ticket_current_visit_kind" ON "queue_tickets" ("visit_id", "kind") WHERE "status" IN ('ACTIVE', 'PAUSED')`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_queue_ticket_active_queue" ON "queue_tickets" ("business_date", "kind", "scope_key", "status", "queued_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_queue_ticket_active_queue"`);
    await queryRunner.query(`DROP INDEX "public"."uq_queue_ticket_current_visit_kind"`);
    await queryRunner.query(`ALTER TABLE "queue_tickets" DROP COLUMN "request_fingerprint"`);
    await queryRunner.query(`ALTER TABLE "queue_tickets" DROP COLUMN "operation"`);
  }
}
