import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReceptionEtaForecasts1792190000000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`
      CREATE TABLE reception_eta_forecasts (
        ticket_id uuid NOT NULL REFERENCES queue_tickets(id) ON DELETE CASCADE,
        queued_at timestamptz NOT NULL,
        version int NOT NULL CHECK (version > 0),
        calculated_at timestamptz NOT NULL,
        estimated_start_at timestamptz,
        actual_started_at timestamptz,
        PRIMARY KEY (ticket_id, queued_at, version)
      )
    `);
  }

  async down(runner: QueryRunner) {
    await runner.query('DROP TABLE reception_eta_forecasts');
  }
}
