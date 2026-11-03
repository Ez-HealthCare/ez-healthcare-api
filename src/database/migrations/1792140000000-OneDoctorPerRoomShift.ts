import { MigrationInterface, QueryRunner } from 'typeorm';

export class OneDoctorPerRoomShift1792140000000 implements MigrationInterface {
  name = 'OneDoctorPerRoomShift1792140000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    const duplicates = await queryRunner.query(
      'SELECT department_id, "shiftDate", "shiftType", COUNT(*)::int AS count FROM doctor_schedules GROUP BY department_id, "shiftDate", "shiftType" HAVING COUNT(*) > 1',
    );
    if (duplicates.length) {
      throw new Error(
        'Resolve overlapping room schedules before applying OneDoctorPerRoomShift: ' +
          JSON.stringify(duplicates),
      );
    }
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_room_shift_doctor" ON "doctor_schedules" ("department_id", "shiftDate", "shiftType")',
    );
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "uq_room_shift_doctor"');
  }
}
