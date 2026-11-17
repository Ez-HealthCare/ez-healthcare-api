import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPatientPregnancy1792170000000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query('ALTER TABLE users ADD COLUMN "isPregnant" boolean NOT NULL DEFAULT false');
    await runner.query('ALTER TABLE visits DROP COLUMN hall_reissue_count');
  }

  async down(runner: QueryRunner) {
    await runner.query(
      'ALTER TABLE visits ADD COLUMN hall_reissue_count integer NOT NULL DEFAULT 0',
    );
    await runner.query('ALTER TABLE users DROP COLUMN "isPregnant"');
  }
}
