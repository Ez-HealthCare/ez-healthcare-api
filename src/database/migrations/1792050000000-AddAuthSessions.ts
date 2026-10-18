import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuthSessions1792050000000 implements MigrationInterface {
  name = 'AddAuthSessions1792050000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE "auth_sessions" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "tokenHash" varchar(64) NOT NULL,
      "expiresAt" timestamptz NOT NULL,
      "rememberMe" boolean NOT NULL DEFAULT false,
      "revokedAt" timestamptz
    )`);
    await runner.query('CREATE INDEX "idx_auth_sessions_user" ON "auth_sessions" ("userId")');
    await runner.query('ALTER TABLE "patient_otps" ALTER COLUMN "otpCode" TYPE varchar(64)');
    await runner.query('UPDATE "patient_otps" SET "isUsed" = true');
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE "auth_sessions"');
    await runner.query('DELETE FROM "patient_otps"');
    await runner.query('ALTER TABLE "patient_otps" ALTER COLUMN "otpCode" TYPE varchar(10)');
  }
}
