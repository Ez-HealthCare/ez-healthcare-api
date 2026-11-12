import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStageEtaTimestamps1792160000000 implements MigrationInterface {
  name = 'AddStageEtaTimestamps1792160000000';

  async up(runner: QueryRunner) {
    await runner.query(
      'ALTER TABLE visits ADD triage_arrived_at timestamptz, ADD triage_started_at timestamptz, ADD clinic_arrived_at timestamptz, ADD clinic_started_at timestamptz',
    );
  }

  async down(runner: QueryRunner) {
    await runner.query(
      'ALTER TABLE visits DROP triage_arrived_at, DROP triage_started_at, DROP clinic_arrived_at, DROP clinic_started_at',
    );
  }
}
