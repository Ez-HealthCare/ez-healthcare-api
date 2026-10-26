import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCalledQueueTicketStatus1792120000000 implements MigrationInterface {
  name = 'AddCalledQueueTicketStatus1792120000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."queue_ticket_status_enum" ADD VALUE IF NOT EXISTS 'CALLED'`,
    );
  }

  public async down(): Promise<void> {
    // PostgreSQL does not safely remove enum values. The status remains inert on rollback.
  }
}
