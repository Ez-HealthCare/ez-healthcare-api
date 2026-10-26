import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateCurrentQueueTicketIndex1792130000000 implements MigrationInterface {
  name = 'UpdateCurrentQueueTicketIndex1792130000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."uq_queue_ticket_current_visit_kind"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_queue_ticket_current_visit_kind" ON "queue_tickets" ("visit_id", "kind") WHERE "status" IN ('ACTIVE', 'CALLED', 'PAUSED')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."uq_queue_ticket_current_visit_kind"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_queue_ticket_current_visit_kind" ON "queue_tickets" ("visit_id", "kind") WHERE "status" IN ('ACTIVE', 'PAUSED')`,
    );
  }
}
