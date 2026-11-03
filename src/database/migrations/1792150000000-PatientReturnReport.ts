import { MigrationInterface, QueryRunner } from 'typeorm';

export class PatientReturnReport1792150000000 implements MigrationInterface {
  name = 'PatientReturnReport1792150000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "visits" ADD "return_reported_at" TIMESTAMP WITH TIME ZONE',
    );
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "visits" DROP COLUMN "return_reported_at"');
  }
}
