import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReceptionDeskShifts1792180000000 implements MigrationInterface {
  name = 'AddReceptionDeskShifts1792180000000';

  async up(runner: QueryRunner) {
    await runner.query(`
      CREATE TABLE reception_desk_shifts (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        business_date date NOT NULL,
        shift_type varchar(16) NOT NULL CHECK (shift_type IN ('MORNING', 'AFTERNOON')),
        desk_code varchar(2) NOT NULL CHECK (desk_code IN ('01', '02')),
        receptionist_id uuid NOT NULL REFERENCES users(id),
        accepting_calls boolean NOT NULL DEFAULT true
      )
    `);
    await runner.query(
      'CREATE UNIQUE INDEX uq_reception_desk_shift ON reception_desk_shifts (business_date, shift_type, desk_code)',
    );
    await runner.query(
      'CREATE UNIQUE INDEX uq_reception_staff_shift ON reception_desk_shifts (business_date, shift_type, receptionist_id)',
    );
    await runner.query(`
      ALTER TABLE queue_tickets
        ADD reception_desk_shift_id uuid REFERENCES reception_desk_shifts(id),
        ADD reception_desk_code varchar(2),
        ADD verification_started_at timestamptz,
        ADD reception_released_at timestamptz
    `);
    await runner.query(`
      CREATE UNIQUE INDEX uq_reception_desk_held_ticket ON queue_tickets (reception_desk_code)
      WHERE kind = 'HALL' AND status = 'CALLED' AND reception_desk_code IS NOT NULL
    `);
  }

  async down(runner: QueryRunner) {
    await runner.query('DROP INDEX uq_reception_desk_held_ticket');
    await runner.query(`
      ALTER TABLE queue_tickets
        DROP reception_desk_shift_id,
        DROP reception_desk_code,
        DROP verification_started_at,
        DROP reception_released_at
    `);
    await runner.query('DROP TABLE reception_desk_shifts');
  }
}
