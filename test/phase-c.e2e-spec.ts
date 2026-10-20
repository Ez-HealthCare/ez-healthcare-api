import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureAuthHttp } from '../src/auth/configure-auth-http';
import { AuthSession } from '../src/auth/entities/auth-session.entity';
import { ApiConfigService } from '../src/config/api-config.service';
import dataSource from '../src/database/data-source';
import { User } from '../src/database/entities/user.entity';
import { Department } from '../src/department/entities/department.entity';
import { QueueTicket } from '../src/visit/entities/queue-ticket.entity';
import { VisitVital } from '../src/visit/entities/visit-vital.entity';
import { Visit } from '../src/visit/entities/visit.entity';
import { QueueTicketKind, QueueTicketStatus } from '../src/visit/enums/queue-ticket.enum';
import { VisitStatus } from '../src/visit/enums/visit-status.enum';
import { Role } from '../src/user/enums/role.enum';
import { QueueTicketService } from '../src/visit/queue-ticket.service';
import { getBusinessTime } from '../src/visit/business-time';

describe('Phase C PostgreSQL integration', () => {
  let app: INestApplication;
  let db: DataSource;
  let jwt: JwtService;
  let nurse: User;
  let doctor: User;
  let admin: User;
  let queueTickets: QueueTicketService;

  const cookieFor = async (user: User) => {
    const session = await db.getRepository(AuthSession).save(
      db.getRepository(AuthSession).create({
        userId: user.id,
        tokenHash: 'integration-only',
        expiresAt: new Date(Date.now() + 60 * 60_000),
        rememberMe: false,
        revokedAt: null,
      }),
    );
    const token = jwt.sign({ sub: user.id, sid: session.id, email: user.email, role: user.role });
    return `ez_access=${token}`;
  };

  const createPatient = async (suffix: string) => {
    const patient = await db.getRepository(User).save(
      db.getRepository(User).create({
        email: `phase-c-${suffix}@example.test`,
        name: `Phase C ${suffix}`,
        role: Role.PATIENT,
        isActive: true,
      }),
    );
    return { patient, cookie: await cookieFor(patient) };
  };

  const issue = (cookie: string, key: string) =>
    request(app.getHttpServer())
      .post('/api/visits/hall-ticket')
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({});

  const intakeBody = {
    chiefComplaint: 'Đau đầu',
    bloodPressureSystolic: 120,
    bloodPressureDiastolic: 80,
    heartRate: 75,
    temperature: 36.8,
    spo2: 98,
    respiratoryRate: 16,
    allergies: ['fixture-allergy'],
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureAuthHttp(app, module.get(ApiConfigService));
    await app.listen(0);
    db = module.get(DataSource);
    jwt = module.get(JwtService);
    queueTickets = module.get(QueueTicketService);
    [nurse, doctor, admin] = await Promise.all([
      db.getRepository(User).findOneByOrFail({ email: 'nurse.emily@ezhealthcare.com' }),
      db.getRepository(User).findOneByOrFail({ email: 'dr.smith@ezhealthcare.com' }),
      db.getRepository(User).findOneByOrFail({ email: 'admin@ezhealthcare.com' }),
    ]);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('issues 20 unique, continuous hall numbers concurrently', async () => {
    const patients = await Promise.all(
      Array.from({ length: 20 }, (_, index) => createPatient(`parallel-${index}`)),
    );
    const responses = await Promise.all(
      patients.map(({ cookie }, index) => issue(cookie, `parallel-${index}`)),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    const sequences = responses.map((response) => Number(response.body.ticket.number.slice(2)));
    const sorted = [...sequences].sort((a, b) => a - b);
    expect(new Set(sequences).size).toBe(20);
    expect(sorted.at(-1)! - sorted[0]).toBe(19);
  });

  it('replays 20 concurrent requests with the same patient and key', async () => {
    const { cookie } = await createPatient('same-key');
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => issue(cookie, 'same-key-20')),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect(new Set(responses.map((response) => response.body.visitId)).size).toBe(1);
    expect(new Set(responses.map((response) => response.body.ticket.id)).size).toBe(1);
  });

  it('rejects an idempotency key reused by another actor', async () => {
    const first = await createPatient('key-owner');
    const second = await createPatient('key-intruder');
    expect((await issue(first.cookie, 'owned-key')).status).toBe(201);
    const conflict = await issue(second.cookie, 'owned-key');
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('allows exactly one of two concurrent reissues with different keys', async () => {
    const { cookie } = await createPatient('reissue-race');
    const visitId = (await issue(cookie, 'reissue-source')).body.visitId;
    const responses = await Promise.all(
      ['race-a', 'race-b'].map((key) =>
        request(app.getHttpServer())
          .post(`/api/visits/${visitId}/reissue`)
          .set('Cookie', cookie)
          .set('Idempotency-Key', key)
          .send({ kind: QueueTicketKind.HALL }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(
      await db.getRepository(QueueTicket).count({
        where: {
          visitId,
          kind: QueueTicketKind.HALL,
          status: QueueTicketStatus.ACTIVE,
        },
      }),
    ).toBe(1);
  });

  it('rolls patient, visit and vitals back when the audit write fails', async () => {
    const { patient, cookie } = await createPatient('rollback');
    const visitId = (await issue(cookie, 'rollback-source')).body.visitId;
    const nurseCookie = await cookieFor(nurse);
    await request(app.getHttpServer())
      .put(`/api/visits/${visitId}/verify`)
      .set('Cookie', nurseCookie)
      .send({ nationalIdVerified: true })
      .expect(200);
    await db.query(`
      CREATE OR REPLACE FUNCTION fail_phase_c_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'RECORD_INTAKE' THEN RAISE EXCEPTION 'phase-c audit failure'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_phase_c_audit_trigger BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION fail_phase_c_audit();
    `);
    try {
      await request(app.getHttpServer())
        .put(`/api/visits/${visitId}/intake`)
        .set('Cookie', nurseCookie)
        .send(intakeBody)
        .expect(500);
    } finally {
      await db.query('DROP TRIGGER IF EXISTS fail_phase_c_audit_trigger ON audit_logs');
      await db.query('DROP FUNCTION IF EXISTS fail_phase_c_audit()');
    }
    const [unchangedPatient, unchangedVisit, vital] = await Promise.all([
      db.getRepository(User).findOneByOrFail({ id: patient.id }),
      db.getRepository(Visit).findOneByOrFail({ id: visitId }),
      db.getRepository(VisitVital).findOne({ where: { visitId } }),
    ]);
    expect(unchangedPatient.allergies).toBeNull();
    expect(unchangedVisit.status).toBe(VisitStatus.RECEPTION_VERIFIED);
    expect(unchangedVisit.intakeCompletedAt).toBeNull();
    expect(vital).toBeNull();
  });

  it('serializes intake against examination start', async () => {
    const { patient } = await createPatient('intake-exam');
    const department = await db.getRepository(Department).findOneByOrFail({ code: 'P.102' });
    const visit = await db.getRepository(Visit).save(
      db.getRepository(Visit).create({
        patientId: patient.id,
        hallTicketNumber: 'TEST-CALLED',
        clinicTicketNumber: 'CL-102-TEST',
        currentDepartmentId: department.id,
        status: VisitStatus.CLINIC_CALLED,
      }),
    );
    await db.getRepository(QueueTicket).save(
      db.getRepository(QueueTicket).create({
        visitId: visit.id,
        kind: QueueTicketKind.CLINIC,
        scopeKey: department.code,
        businessDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }),
        sequence: 9001,
        displayNumber: 'CL-102-TEST',
        status: QueueTicketStatus.ACTIVE,
        issuedById: nurse.id,
        idempotencyKey: 'intake-exam-fixture',
        queuedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      }),
    );
    const [intake, start] = await Promise.all([
      request(app.getHttpServer())
        .put(`/api/visits/${visit.id}/intake`)
        .set('Cookie', await cookieFor(nurse))
        .send(intakeBody),
      request(app.getHttpServer())
        .post(`/api/visits/${visit.id}/start-exam`)
        .set('Cookie', await cookieFor(doctor))
        .send({}),
    ]);
    expect([200, 409]).toContain(intake.status);
    expect([201, 409]).toContain(start.status);
    expect([intake.status, start.status].filter((status) => status < 300).length).toBeGreaterThan(
      0,
    );
    const saved = await db.getRepository(Visit).findOneByOrFail({ id: visit.id });
    if (saved.status === VisitStatus.IN_EXAMINATION) {
      const intakeAudit = await db.query(
        `SELECT created_at FROM audit_logs WHERE action = 'RECORD_INTAKE' AND target_entity_id = $1`,
        [visit.id],
      );
      const examAudit = await db.query(
        `SELECT created_at FROM audit_logs WHERE action = 'START_EXAMINATION' AND target_entity_id = $1`,
        [visit.id],
      );
      if (intakeAudit[0]) expect(intakeAudit[0].created_at <= examAudit[0].created_at).toBe(true);
    }
  });

  it('expires tickets at API boundaries and exposes only the staff expired queue', async () => {
    const { patient, cookie } = await createPatient('expired');
    const visitId = (await issue(cookie, 'expired-source')).body.visitId;
    await db
      .getRepository(QueueTicket)
      .update({ visitId }, { expiresAt: new Date(Date.now() - 1000) });
    const current = await request(app.getHttpServer())
      .get('/api/visits/me/current')
      .set('Cookie', cookie)
      .expect(200);
    expect(current.body.ticketStatus).toBe(QueueTicketStatus.EXPIRED);
    expect(current.body.canPatientReissue).toBe(false);
    const staff = await request(app.getHttpServer())
      .get('/api/visits/reception/expired')
      .set('Cookie', await cookieFor(nurse))
      .expect(200);
    expect(staff.body.some((item: { visitId: string }) => item.visitId === visitId)).toBe(true);
    await request(app.getHttpServer())
      .post(`/api/visits/${visitId}/reissue`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'patient-expired-reissue')
      .send({ kind: QueueTicketKind.HALL })
      .expect(409);
    expect(patient.role).toBe(Role.PATIENT);
  });

  it('counts distinct visits for quota so reissue does not consume a second slot', async () => {
    const department = await db.getRepository(Department).findOneByOrFail({ code: 'P.108' });
    const originalQuota = department.maxQuotaPerSlot;
    department.maxQuotaPerSlot = 1;
    await db.getRepository(Department).save(department);
    const nurseCookie = await cookieFor(nurse);
    const stage = async (suffix: string, sequence: number) => {
      const { patient } = await createPatient(`quota-${suffix}`);
      const visit = await db.getRepository(Visit).save(
        db.getRepository(Visit).create({
          patientId: patient.id,
          hallTicketNumber: `QUOTA-${suffix}`,
          status: VisitStatus.TRIAGE_PENDING,
          intakeCompletedAt: new Date(),
        }),
      );
      const business = getBusinessTime();
      await db.getRepository(QueueTicket).save(
        db.getRepository(QueueTicket).create({
          visitId: visit.id,
          kind: QueueTicketKind.HALL,
          scopeKey: 'FACILITY',
          businessDate: business.businessDate,
          sequence,
          displayNumber: `A-${sequence}`,
          status: QueueTicketStatus.ACTIVE,
          issuedById: patient.id,
          idempotencyKey: `quota-source-${suffix}`,
          queuedAt: new Date(),
          expiresAt: business.expiresAt,
        }),
      );
      return visit;
    };
    try {
      const first = await stage('first', 9501);
      const second = await stage('second', 9502);
      await request(app.getHttpServer())
        .post(`/api/visits/${first.id}/assign-clinic`)
        .set('Cookie', nurseCookie)
        .set('Idempotency-Key', 'quota-assign-first')
        .send({ departmentCode: department.code })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/visits/${first.id}/reissue`)
        .set('Cookie', nurseCookie)
        .set('Idempotency-Key', 'quota-reissue-first')
        .send({ kind: QueueTicketKind.CLINIC, reason: 'Integration quota check' })
        .expect(201);
      const [{ count }] = await db.query(
        `SELECT COUNT(DISTINCT visit_id)::int AS count FROM queue_tickets
          WHERE kind = 'CLINIC' AND scope_key = $1
            AND status IN ('ACTIVE', 'PAUSED', 'COMPLETED')`,
        [department.code],
      );
      expect(Number(count)).toBe(1);
      await request(app.getHttpServer())
        .post(`/api/visits/${second.id}/assign-clinic`)
        .set('Cookie', nurseCookie)
        .set('Idempotency-Key', 'quota-assign-second')
        .send({ departmentCode: department.code })
        .expect(409)
        .expect(({ body }) => expect(body.code).toBe('ROOM_QUOTA_REACHED'));
    } finally {
      department.maxQuotaPerSlot = originalQuota;
      await db.getRepository(Department).save(department);
    }
  });

  it('keeps room counters independent and resets them on a new business date', async () => {
    const { businessDate } = getBusinessTime();
    const next = new Date(`${businessDate}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextDate = next.toISOString().slice(0, 10);
    const ticketsBefore = await db.getRepository(QueueTicket).count();
    const [roomA, roomB, roomANextDay] = await db.transaction(async (manager) => [
      await queueTickets.nextSequence(manager, QueueTicketKind.CLINIC, 'P.105', businessDate),
      await queueTickets.nextSequence(manager, QueueTicketKind.CLINIC, 'P.102', businessDate),
      await queueTickets.nextSequence(manager, QueueTicketKind.CLINIC, 'P.105', nextDate),
    ]);
    expect(roomA).toBe(1);
    expect(roomB).toBe(1);
    expect(roomANextDay).toBe(1);
    expect(await db.getRepository(QueueTicket).count()).toBe(ticketsBefore);
  });

  it('enforces anonymous, admin, patient and wrong-room access boundaries', async () => {
    await request(app.getHttpServer()).get('/api/visits/reception/queue').expect(401);
    await request(app.getHttpServer())
      .get('/api/visits/reception/queue')
      .set('Cookie', await cookieFor(admin))
      .expect(403);
    const { cookie } = await createPatient('forbidden');
    await request(app.getHttpServer())
      .get('/api/visits/reception/queue')
      .set('Cookie', cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/visits/queue/P.104')
      .set('Cookie', await cookieFor(doctor))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('ROOM_ACCESS_DENIED'));
  });

  it('runs Phase B/C migrations down and up without losing seed rows', async () => {
    const usersBefore = await db.getRepository(User).count();
    await app.close();
    app = undefined as unknown as INestApplication;
    await dataSource.initialize();
    try {
      await dataSource.undoLastMigration();
      await dataSource.undoLastMigration();
      expect(Number((await dataSource.query('SELECT COUNT(*) AS count FROM users'))[0].count)).toBe(
        usersBefore,
      );
      const migrations = await dataSource.runMigrations();
      expect(migrations.map((migration) => migration.name)).toEqual([
        'AddPhaseBQueues1792060000000',
        'HardenPhaseBQueues1792070000000',
      ]);
      expect(Number((await dataSource.query('SELECT COUNT(*) AS count FROM users'))[0].count)).toBe(
        usersBefore,
      );
    } finally {
      await dataSource.destroy();
    }
  });
});
