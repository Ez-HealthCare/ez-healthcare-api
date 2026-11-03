import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
import { DoctorSchedule } from '../src/department/entities/doctor-schedule.entity';
import { Department } from '../src/department/entities/department.entity';
import { QueueTicket } from '../src/visit/entities/queue-ticket.entity';
import { ReceptionRequest } from '../src/reception-request/entities/reception-request.entity';
import { ReceptionRequestStatus } from '../src/reception-request/enums/reception-request-status.enum';
import { VisitVital } from '../src/visit/entities/visit-vital.entity';
import { Visit } from '../src/visit/entities/visit.entity';
import { QueueTicketKind, QueueTicketStatus } from '../src/visit/enums/queue-ticket.enum';
import { VisitStatus } from '../src/visit/enums/visit-status.enum';
import { VisitStep } from '../src/visit/entities/visit-step.entity';
import { StepStatus } from '../src/visit/enums/step-status.enum';
import { Prescription } from '../src/prescription/entities/prescription.entity';
import { Notification } from '../src/notification/notification.entity';
import { Role } from '../src/user/enums/role.enum';
import { QueueTicketService } from '../src/visit/queue-ticket.service';
import { getBusinessTime } from '../src/visit/business-time';

describe('Phase C PostgreSQL integration', () => {
  let app: INestApplication;
  let db: DataSource;
  let jwt: JwtService;
  let nurse: User;
  let receptionist: User;
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
    [nurse, doctor, admin, receptionist] = await Promise.all([
      db.getRepository(User).findOneByOrFail({ email: 'nurse.emily@ezhealthcare.com' }),
      db.getRepository(User).findOneByOrFail({ email: 'dr.smith@ezhealthcare.com' }),
      db.getRepository(User).findOneByOrFail({ email: 'admin@ezhealthcare.com' }),
      db.getRepository(User).findOneByOrFail({ email: 'reception.clara@ezhealthcare.com' }),
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
    const receptionistCookie = await cookieFor(receptionist);
    await request(app.getHttpServer())
      .put(`/api/visits/${visitId}/verify`)
      .set('Cookie', nurseCookie)
      .send({ nationalIdVerified: true })
      .expect(403);
    await request(app.getHttpServer())
      .put(`/api/visits/${visitId}/verify`)
      .set('Cookie', receptionistCookie)
      .send({ nationalIdVerified: true })
      .expect(409);
    await request(app.getHttpServer())
      .put(`/api/visits/${visitId}/reception/call`)
      .set('Cookie', receptionistCookie)
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/visits/${visitId}/verify`)
      .set('Cookie', receptionistCookie)
      .send({ nationalIdVerified: true })
      .expect(200);
    expect((await db.getRepository(Visit).findOneByOrFail({ id: visitId })).status).toBe(
      VisitStatus.TRIAGE_PENDING,
    );
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
    expect(unchangedVisit.status).toBe(VisitStatus.TRIAGE_PENDING);
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
        currentDoctorId: doctor.id,
        currentDepartmentId: department.id,
        status: VisitStatus.CLINIC_CALLED,
      }),
    );
    const business = getBusinessTime(new Date(), app.get(ApiConfigService).queueIssuanceWindows);
    const sequence = await db.transaction((manager) =>
      queueTickets.nextSequence(
        manager,
        QueueTicketKind.CLINIC,
        department.code,
        business.businessDate,
      ),
    );
    await db.getRepository(QueueTicket).save(
      db.getRepository(QueueTicket).create({
        visitId: visit.id,
        kind: QueueTicketKind.CLINIC,
        scopeKey: department.code,
        businessDate: business.businessDate,
        sequence,
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
      await queueTickets.nextSequence(
        manager,
        QueueTicketKind.CLINIC,
        'TEST-COUNTER-A',
        businessDate,
      ),
      await queueTickets.nextSequence(
        manager,
        QueueTicketKind.CLINIC,
        'TEST-COUNTER-B',
        businessDate,
      ),
      await queueTickets.nextSequence(manager, QueueTicketKind.CLINIC, 'TEST-COUNTER-A', nextDate),
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

  it('converts an online request into the live queue, then preserves the handed-off visit in daily records', async () => {
    const { patient } = await createPatient('records-online');
    await db
      .getRepository(User)
      .update(patient.id, { nationalId: '070000009876', insuranceCardNumber: 'TEST-BHYT-9876' });
    const pending = await db.getRepository(ReceptionRequest).save(
      db.getRepository(ReceptionRequest).create({
        patientId: patient.id,
        status: ReceptionRequestStatus.RECEPTION_PENDING,
        chiefComplaint: 'Records integration',
        submittedAt: new Date(),
      }),
    );
    const receptionCookie = await cookieFor(receptionist);
    const search = { search: patient.id };
    const list = () =>
      request(app.getHttpServer())
        .get('/api/visits/reception/records')
        .set('Cookie', receptionCookie)
        .query(search);
    expect((await list().expect(200)).body.total).toBe(0);
    const pendingList = await request(app.getHttpServer())
      .get('/api/reception-requests/reception/pending')
      .set('Cookie', receptionCookie)
      .query({ search: '070000009876' })
      .expect(200);
    expect(pendingList.body.map((item: any) => item.id)).toContain(pending.id);
    const issued = await request(app.getHttpServer())
      .post(`/api/reception-requests/reception/${pending.id}/confirm`)
      .set('Cookie', receptionCookie)
      .send({})
      .expect(201);
    const id = issued.body.visitId;
    await request(app.getHttpServer())
      .post(`/api/reception-requests/reception/${pending.id}/confirm`)
      .set('Cookie', receptionCookie)
      .send({})
      .expect(409);
    const queue = await request(app.getHttpServer())
      .get('/api/visits/reception/queue')
      .set('Cookie', receptionCookie)
      .expect(200);
    expect(queue.body.map((item: any) => item.visitId)).toContain(id);
    await request(app.getHttpServer())
      .put(`/api/visits/${id}/reception/call`)
      .set('Cookie', receptionCookie)
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/visits/${id}/verify`)
      .set('Cookie', receptionCookie)
      .send({ nationalIdVerified: true })
      .expect(200);
    const afterQueue = await request(app.getHttpServer())
      .get('/api/visits/reception/queue')
      .set('Cookie', receptionCookie)
      .expect(200);
    expect(afterQueue.body.map((item: any) => item.visitId)).not.toContain(id);
    const records = (await list().expect(200)).body;
    expect(records.total).toBe(1);
    expect(records.items[0]).toMatchObject({
      visitId: id,
      status: VisitStatus.TRIAGE_PENDING,
      isVerified: true,
    });
    expect(records.items[0].patient).toMatchObject({
      nationalId: '070000009876',
      insuranceCardNumber: 'TEST-BHYT-9876',
    });
    expect(records.items[0].ticketHistory[0]).toMatchObject({
      status: QueueTicketStatus.COMPLETED,
      callAttempts: 1,
    });
    expect(records.items[0].patient.password).toBeUndefined();
    for (const value of ['070000009876', 'TEST-BHYT-9876', issued.body.hallTicketNumber]) {
      const found = await request(app.getHttpServer())
        .get('/api/visits/reception/records')
        .set('Cookie', receptionCookie)
        .query({ search: value })
        .expect(200);
      expect(found.body.items.map((item: any) => item.visitId)).toContain(id);
    }
    // A completed or cancelled visit remains traceable; it does not re-enter the live queue.
    for (const status of [VisitStatus.COMPLETED, VisitStatus.CANCELLED]) {
      await db.getRepository(Visit).update(id, { status });
      const found = await request(app.getHttpServer())
        .get('/api/visits/reception/records')
        .set('Cookie', receptionCookie)
        .query({ ...search, status })
        .expect(200);
      expect(found.body.total).toBe(1);
      expect(found.body.items[0].status).toBe(status);
    }
  });

  it('deduplicates reissued tickets, searches old numbers and scopes records by business date', async () => {
    const { patient, cookie } = await createPatient('records-reissue');
    const issued = await issue(cookie, 'records-reissue-initial').expect(201);
    const id = issued.body.visitId;
    await request(app.getHttpServer())
      .post(`/api/visits/${id}/reissue`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'records-reissue-next')
      .send({ kind: QueueTicketKind.HALL })
      .expect(201);
    const receptionCookie = await cookieFor(receptionist);
    const old = await request(app.getHttpServer())
      .get('/api/visits/reception/records')
      .set('Cookie', receptionCookie)
      .query({ search: issued.body.hallTicketNumber })
      .expect(200);
    expect(old.body.items.map((item: any) => item.visitId)).toContain(id);
    const list = await request(app.getHttpServer())
      .get('/api/visits/reception/records')
      .set('Cookie', receptionCookie)
      .query({ search: patient.id, pageSize: 1 })
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].ticketHistory).toHaveLength(2);
    expect(list.body.items[0].ticketHistory.map((ticket: any) => ticket.status).sort()).toEqual([
      'ACTIVE',
      'SUPERSEDED',
    ]);
    const anotherDay = await request(app.getHttpServer())
      .get('/api/visits/reception/records')
      .set('Cookie', receptionCookie)
      .query({ search: patient.id, businessDate: '2020-01-01' })
      .expect(200);
    expect(anotherDay.body.total).toBe(0);
    const nextPage = await request(app.getHttpServer())
      .get('/api/visits/reception/records')
      .set('Cookie', receptionCookie)
      .query({ search: patient.id, page: 2, pageSize: 1 })
      .expect(200);
    expect(nextPage.body.total).toBe(1);
    expect(nextPage.body.items).toHaveLength(0);
    const wildcard = await request(app.getHttpServer())
      .get('/api/visits/reception/records')
      .set('Cookie', receptionCookie)
      .query({ search: '%' })
      .expect(200);
    expect(wildcard.body.total).toBe(0);
  });

  it('restricts administrative record search to receptionists and rejects invalid filters', async () => {
    await request(app.getHttpServer()).get('/api/visits/reception/records').expect(401);
    for (const user of [nurse, doctor, admin, (await createPatient('records-forbidden')).patient]) {
      await request(app.getHttpServer())
        .get('/api/visits/reception/records')
        .set('Cookie', await cookieFor(user))
        .expect(403);
    }
    const cookie = await cookieFor(receptionist);
    for (const query of [
      { businessDate: '2026-02-30' },
      { businessDate: 'bad-date' },
      { status: 'INVALID' },
      { page: 0 },
      { pageSize: 101 },
      { search: 'x'.repeat(101) },
    ]) {
      await request(app.getHttpServer())
        .get('/api/visits/reception/records')
        .set('Cookie', cookie)
        .query(query)
        .expect(400);
    }
  });

  it('allows only the examining doctor to order diagnostics and conclude, and denies an unassigned doctor', async () => {
    const department = await db.getRepository(Department).findOneByOrFail({ code: 'P.102' });
    const other = await db.getRepository(User).save(
      db.getRepository(User).create({
        email: 'ownership-doctor@example.test',
        name: 'Other room doctor',
        role: Role.DOCTOR,
        isActive: true,
      }),
    );
    const ownCookie = await cookieFor(doctor),
      otherCookie = await cookieFor(other);
    for (const operation of ['orders', 'conclusion']) {
      const { patient } = await createPatient('ownership-' + operation);
      const visit = await db.getRepository(Visit).save(
        db.getRepository(Visit).create({
          patientId: patient.id,
          hallTicketNumber: 'OWNERSHIP-' + operation,
          status: VisitStatus.IN_EXAMINATION,
          currentDepartmentId: department.id,
          currentDoctorId: doctor.id,
          intakeCompletedAt: new Date(),
        }),
      );
      await db.getRepository(VisitVital).save(
        db.getRepository(VisitVital).create({
          visitId: visit.id,
          nurseId: nurse.id,
          bloodPressureSystolic: 120,
          bloodPressureDiastolic: 80,
          heartRate: 75,
          temperature: 36.8,
          spo2: 98,
          respiratoryRate: 16,
        }),
      );
      const payload =
        operation === 'orders'
          ? { orders: ['P.201'], workingDiagnosis: 'Integration diagnostic order' }
          : { icd10Code: 'Z00.0', icd10Name: 'Integration examination', items: [] };
      const queue = await request(app.getHttpServer())
        .get('/api/visits/queue/P.102')
        .set('Cookie', ownCookie)
        .expect(200);
      const item = queue.body.queue.find((row: any) => row.visitId === visit.id);
      expect(item.currentDoctor).toEqual({ id: doctor.id, name: doctor.name });
      expect(item.currentDoctor.email).toBeUndefined();
      await request(app.getHttpServer())
        .post(`/api/visits/${visit.id}/${operation}`)
        .set('Cookie', otherCookie)
        .send(payload)
        .expect(403);
      expect((await db.getRepository(Visit).findOneByOrFail({ id: visit.id })).status).toBe(
        VisitStatus.IN_EXAMINATION,
      );
      await request(app.getHttpServer())
        .post(`/api/visits/${visit.id}/${operation}`)
        .set('Cookie', ownCookie)
        .send(payload)
        .expect(operation === 'orders' ? 201 : 200);
      const dossier = await request(app.getHttpServer())
        .get(`/api/visits/${visit.id}`)
        .set('Cookie', ownCookie)
        .expect(200);
      expect(dossier.body.status).toBe(
        operation === 'orders' ? VisitStatus.PARACLINICAL_PENDING : VisitStatus.COMPLETED,
      );
      if (operation === 'conclusion') expect(dossier.body.prescription.icd10Code).toBe('Z00.0');
    }
  });

  it('allows exactly one concurrent schedule per room/shift and rejects another room for the same doctor', async () => {
    const depRepo = db.getRepository(Department);
    const template = await depRepo.findOneByOrFail({ code: 'P.102' });
    const rooms = await depRepo.save(
      ['P.910', 'P.911'].map((code) =>
        depRepo.create({
          code,
          name: 'Schedule isolation ' + code,
          roomType: template.roomType,
          floor: 1,
        }),
      ),
    );
    const userRepo = db.getRepository(User);
    const doctors = await userRepo.save(
      ['a', 'b'].map((suffix) =>
        userRepo.create({
          email: 'schedule-race-' + suffix + '@example.test',
          name: 'Schedule race ' + suffix,
          role: Role.DOCTOR,
          isActive: true,
        }),
      ),
    );
    const cookie = await cookieFor(admin);
    const day = getBusinessTime().businessDate;
    const payload = { departmentCode: rooms[0].code, shiftDate: day, shiftType: 'MORNING' };
    const responses = await Promise.all(
      doctors.map((user) =>
        request(app.getHttpServer())
          .post('/api/admin/schedules')
          .set('Cookie', cookie)
          .send({ ...payload, doctorId: user.id }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = doctors[responses.findIndex((r) => r.status === 201)];
    await request(app.getHttpServer())
      .post('/api/admin/schedules')
      .set('Cookie', cookie)
      .send({ ...payload, doctorId: winner.id, departmentCode: rooms[1].code })
      .expect(409);
    // A room may have a different doctor in the next shift.
    const loser = doctors.find((user) => user.id !== winner.id)!;
    await request(app.getHttpServer())
      .post('/api/admin/schedules')
      .set('Cookie', cookie)
      .send({ ...payload, doctorId: loser.id, shiftType: 'AFTERNOON' })
      .expect(201);
  });

  it('serializes two examination starts so one room cannot examine two patients at once', async () => {
    const depRepo = db.getRepository(Department),
      userRepo = db.getRepository(User);
    const template = await depRepo.findOneByOrFail({ code: 'P.102' });
    const room = await depRepo.save(
      depRepo.create({
        code: 'P.912',
        name: 'Examination race room',
        roomType: template.roomType,
        floor: 1,
      }),
    );
    const doc = await userRepo.save(
      userRepo.create({
        email: 'exam-race-doctor@example.test',
        name: 'Exam race doctor',
        role: Role.DOCTOR,
        isActive: true,
      }),
    );
    const business = getBusinessTime(new Date(), app.get(ApiConfigService).queueIssuanceWindows);
    await db.getRepository(DoctorSchedule).save(
      db.getRepository(DoctorSchedule).create({
        doctorId: doc.id,
        departmentId: room.id,
        shiftDate: new Date(business.businessDate),
        shiftType: business.shiftType!,
      }),
    );
    const visits = [];
    for (const suffix of ['first', 'second']) {
      const { patient } = await createPatient('exam-race-' + suffix);
      const visit = await db.getRepository(Visit).save(
        db.getRepository(Visit).create({
          patientId: patient.id,
          hallTicketNumber: 'RACE-' + suffix,
          status: VisitStatus.CLINIC_CALLED,
          currentDepartmentId: room.id,
          initialDepartmentId: template.id,
          currentDoctorId: doc.id,
        }),
      );
      const sequence = await db.transaction((manager) =>
        queueTickets.nextSequence(
          manager,
          QueueTicketKind.CLINIC,
          room.code,
          business.businessDate,
        ),
      );
      await db.getRepository(QueueTicket).save(
        db.getRepository(QueueTicket).create({
          visitId: visit.id,
          kind: QueueTicketKind.CLINIC,
          scopeKey: room.code,
          businessDate: business.businessDate,
          sequence,
          displayNumber: 'RACE-' + sequence,
          status: QueueTicketStatus.ACTIVE,
          issuedById: nurse.id,
          idempotencyKey: 'exam-race-ticket-' + suffix,
          queuedAt: new Date(),
          expiresAt: business.expiresAt,
        }),
      );
      visits.push(visit);
    }
    const cookie = await cookieFor(doc);
    const starts = await Promise.all(
      visits.map((visit) =>
        request(app.getHttpServer())
          .post(`/api/visits/${visit.id}/start-exam`)
          .set('Cookie', cookie)
          .send({}),
      ),
    );
    expect(starts.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await db
        .getRepository(Visit)
        .count({ where: { currentDepartmentId: room.id, status: VisitStatus.IN_EXAMINATION } }),
    ).toBe(1);
    const winner = visits[starts.findIndex((r) => r.status === 201)],
      loser = visits[starts.findIndex((r) => r.status === 409)];
    await request(app.getHttpServer())
      .post(`/api/visits/${winner.id}/start-exam`)
      .set('Cookie', cookie)
      .send({})
      .expect(409);
    await request(app.getHttpServer())
      .put(`/api/visits/${loser.id}/call`)
      .set('Cookie', cookie)
      .send({})
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('ROOM_BUSY'));
    const queue = await request(app.getHttpServer())
      .get('/api/visits/queue/' + room.code)
      .set('Cookie', cookie)
      .expect(200);
    expect(queue.body.queue).toHaveLength(2);
    expect(
      queue.body.queue.filter((row: any) => row.status === VisitStatus.IN_EXAMINATION),
    ).toHaveLength(1);
    await db.getRepository(VisitVital).save(
      db.getRepository(VisitVital).create({
        visitId: winner.id,
        nurseId: nurse.id,
        bloodPressureSystolic: 120,
        bloodPressureDiastolic: 80,
        heartRate: 75,
        temperature: 36.8,
        spo2: 98,
        respiratoryRate: 16,
      }),
    );
    const order = await request(app.getHttpServer())
      .post(`/api/visits/${winner.id}/orders`)
      .set('Cookie', cookie)
      .send({ orders: ['P.201'], workingDiagnosis: 'Room release integration' })
      .expect(201);
    expect(order.body.sortedOrder).toContain(room.code);
    expect(order.body.sortedOrder).not.toContain(template.code);
    // Sending the current patient to diagnostics releases the room for the next visit.
    await request(app.getHttpServer())
      .put(`/api/visits/${loser.id}/call`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/visits/${loser.id}/start-exam`)
      .set('Cookie', cookie)
      .send({})
      .expect(201);
  });

  it('lets the assigned doctor requeue a returned patient after three calls without duplicate effects', async () => {
    const depRepo = db.getRepository(Department),
      userRepo = db.getRepository(User);
    const template = await depRepo.findOneByOrFail({ code: 'P.102' });
    const room = await depRepo.save(
      depRepo.create({
        code: 'P.913',
        name: 'Doctor requeue test',
        roomType: template.roomType,
        floor: 1,
      }),
    );
    const doc = await userRepo.save(
      userRepo.create({
        email: 'requeue-doctor@example.test',
        name: 'Requeue doctor',
        role: Role.DOCTOR,
        isActive: true,
      }),
    );
    const business = getBusinessTime(new Date(), app.get(ApiConfigService).queueIssuanceWindows);
    await db.getRepository(DoctorSchedule).save(
      db.getRepository(DoctorSchedule).create({
        doctorId: doc.id,
        departmentId: room.id,
        shiftDate: new Date(business.businessDate),
        shiftType: business.shiftType!,
      }),
    );
    const visits = [];
    for (const suffix of ['returning', 'waiting']) {
      const { patient } = await createPatient('requeue-' + suffix);
      const visit = await db.getRepository(Visit).save(
        db.getRepository(Visit).create({
          patientId: patient.id,
          hallTicketNumber: 'RETURN-' + suffix,
          status: VisitStatus.CLINIC_WAITING,
          currentDepartmentId: room.id,
        }),
      );
      const sequence = await db.transaction((manager) =>
        queueTickets.nextSequence(
          manager,
          QueueTicketKind.CLINIC,
          room.code,
          business.businessDate,
        ),
      );
      const number = 'CL-913-' + sequence;
      await db.getRepository(Visit).update(visit.id, { clinicTicketNumber: number });
      await db.getRepository(QueueTicket).save(
        db.getRepository(QueueTicket).create({
          visitId: visit.id,
          kind: QueueTicketKind.CLINIC,
          scopeKey: room.code,
          businessDate: business.businessDate,
          sequence,
          displayNumber: number,
          status: QueueTicketStatus.ACTIVE,
          issuedById: nurse.id,
          idempotencyKey: 'doctor-requeue-' + suffix,
          queuedAt: new Date(Date.now() - 2000),
          expiresAt: business.expiresAt,
        }),
      );
      visits.push({ ...visit, clinicTicketNumber: number });
    }
    const [returning, waiting] = visits,
      cookie = await cookieFor(doc);
    const call = () =>
      request(app.getHttpServer())
        .put(`/api/visits/${returning.id}/call`)
        .set('Cookie', cookie)
        .send({});
    for (let count = 1; count <= 3; count++) {
      const result = await call().expect(200);
      expect(result.body.callAttempts).toBe(count);
      expect(result.body.status).toBe(
        count === 3 ? VisitStatus.TEMPORARILY_ABSENT : VisitStatus.CLINIC_CALLED,
      );
    }
    await request(app.getHttpServer())
      .post(`/api/visits/${returning.id}/start-exam`)
      .set('Cookie', cookie)
      .send({})
      .expect(409);
    const requeue = (actorCookie: string, reason = 'Patient returned to consultation room') =>
      request(app.getHttpServer())
        .post(`/api/visits/${returning.id}/requeue`)
        .set('Cookie', actorCookie)
        .send({ reason });
    await requeue(await cookieFor(doctor)).expect(403);
    await requeue(await cookieFor(admin)).expect(403);
    const { cookie: patientCookie } = await createPatient('requeue-forbidden');
    await requeue(patientCookie).expect(403);
    await requeue(cookie, '   ').expect(400);
    const results = await Promise.all([requeue(cookie), requeue(cookie)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const saved = await db.getRepository(Visit).findOneByOrFail({ id: returning.id });
    const ticket = await db
      .getRepository(QueueTicket)
      .findOneByOrFail({ visitId: returning.id, kind: QueueTicketKind.CLINIC });
    expect(saved.status).toBe(VisitStatus.CLINIC_WAITING);
    expect(saved.clinicTicketNumber).toBe(returning.clinicTicketNumber);
    expect(ticket.status).toBe(QueueTicketStatus.ACTIVE);
    expect(ticket.callAttempts).toBe(0);
    expect(
      (
        await db.query(
          "SELECT COUNT(*)::int AS count FROM audit_logs WHERE action='REQUEUE_VISIT' AND target_entity_id=$1",
          [returning.id],
        )
      )[0].count,
    ).toBe(1);
    const queue = await request(app.getHttpServer())
      .get('/api/visits/queue/' + room.code)
      .set('Cookie', cookie)
      .expect(200);
    expect(queue.body.queue.map((row: any) => row.visitId)).toEqual([waiting.id, returning.id]);
    // Nurse and reception retain their existing ability to restore a returned patient.
    for (const actor of [nurse, receptionist]) {
      for (let count = 0; count < 3; count++) await call().expect(200);
      await requeue(await cookieFor(actor)).expect(201);
    }
    await call()
      .expect(200)
      .expect(({ body }) => expect(body.callAttempts).toBe(1));
    await db.getRepository(Visit).update(returning.id, { status: VisitStatus.TEMPORARILY_ABSENT });
    await db.getRepository(QueueTicket).update(ticket.id, {
      status: QueueTicketStatus.PAUSED,
      expiresAt: new Date(Date.now() - 1000),
    });
    await requeue(cookie)
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('TICKET_EXPIRED'));
  });

  it('accepts an owner-scoped patient return report once and notifies the room doctor without requeueing', async () => {
    const { patient, cookie: patientCookie } = await createPatient('report-return-owner');
    const { cookie: otherCookie } = await createPatient('report-return-other');
    const doc = await db.getRepository(User).save(
      db.getRepository(User).create({
        email: 'return-notify-doctor@example.test',
        name: 'Return notification doctor',
        role: Role.DOCTOR,
        isActive: true,
      }),
    );
    const template = await db.getRepository(Department).findOneByOrFail({ code: 'P.102' });
    const room = await db.getRepository(Department).save(
      db.getRepository(Department).create({
        code: 'P.914',
        name: 'Return reporting room',
        roomType: template.roomType,
        floor: 1,
      }),
    );
    const business = getBusinessTime(new Date(), app.get(ApiConfigService).queueIssuanceWindows);
    await db.getRepository(DoctorSchedule).save(
      db.getRepository(DoctorSchedule).create({
        doctorId: doc.id,
        departmentId: room.id,
        shiftDate: new Date(business.businessDate),
        shiftType: business.shiftType!,
      }),
    );
    const visit = await db.getRepository(Visit).save(
      db.getRepository(Visit).create({
        patientId: patient.id,
        hallTicketNumber: 'RETURN-REPORT',
        clinicTicketNumber: 'CL-914-01',
        status: VisitStatus.TEMPORARILY_ABSENT,
        currentDepartmentId: room.id,
        currentDoctorId: doc.id,
      }),
    );
    const ticket = await db.getRepository(QueueTicket).save(
      db.getRepository(QueueTicket).create({
        visitId: visit.id,
        kind: QueueTicketKind.CLINIC,
        scopeKey: room.code,
        businessDate: business.businessDate,
        sequence: 1,
        displayNumber: 'CL-914-01',
        status: QueueTicketStatus.PAUSED,
        callAttempts: 3,
        issuedById: nurse.id,
        idempotencyKey: 'patient-return-ticket',
        queuedAt: new Date(Date.now() - 5000),
        expiresAt: business.expiresAt,
      }),
    );
    const report = (cookie?: string) => {
      const req = request(app.getHttpServer()).post(`/api/visits/${visit.id}/report-return`);
      if (cookie) req.set('Cookie', cookie);
      return req.send({});
    };
    await report().expect(401);
    await report(otherCookie).expect(403);
    const doctorCookie = await cookieFor(doc);
    await report(doctorCookie).expect(403);
    const responses = await Promise.all([report(patientCookie), report(patientCookie)]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(responses[0].body.returnReportedAt).toBeTruthy();
    expect(responses[0].body.returnReportedAt).toBe(responses[1].body.returnReportedAt);
    const current = await request(app.getHttpServer())
      .get('/api/visits/me/current')
      .set('Cookie', patientCookie)
      .expect(200);
    expect(current.body.status).toBe(VisitStatus.TEMPORARILY_ABSENT);
    expect(current.body.ticketStatus).toBe(QueueTicketStatus.PAUSED);
    expect(current.body.returnReportedAt).toBe(responses[0].body.returnReportedAt);
    const queued = await request(app.getHttpServer())
      .get('/api/visits/queue/' + room.code)
      .set('Cookie', doctorCookie)
      .expect(200);
    expect(queued.body.queue[0].returnReportedAt).toBe(current.body.returnReportedAt);
    const notifications = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Cookie', doctorCookie)
      .expect(200);
    expect(
      notifications.body.filter(
        (n: any) => n.type === 'PATIENT_RETURN_REPORTED' && n.visitId === visit.id,
      ),
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "SELECT COUNT(*)::int AS count FROM audit_logs WHERE action='REPORT_PATIENT_RETURN' AND target_entity_id=$1",
          [visit.id],
        )
      )[0].count,
    ).toBe(1);
    await request(app.getHttpServer())
      .post(`/api/visits/${visit.id}/requeue`)
      .set('Cookie', patientCookie)
      .send({ reason: 'Self requeue' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/visits/${visit.id}/requeue`)
      .set('Cookie', doctorCookie)
      .send({ reason: 'Patient has reported returning' })
      .expect(201);
    const saved = await db.getRepository(Visit).findOneByOrFail({ id: visit.id });
    expect(saved.returnReportedAt).toBeNull();
    expect(saved.status).toBe(VisitStatus.CLINIC_WAITING);
    await report(patientCookie).expect(409);
    for (let index = 0; index < 3; index++)
      await request(app.getHttpServer())
        .put(`/api/visits/${visit.id}/call`)
        .set('Cookie', doctorCookie)
        .send({})
        .expect(200);
    await db
      .getRepository(QueueTicket)
      .update(ticket.id, { expiresAt: new Date(Date.now() - 1000) });
    await report(patientCookie)
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('TICKET_EXPIRED'));
  });

  it('atomically concludes, notifies once, and exposes only the owning patient history and prescription', async () => {
    const { patient, cookie } = await createPatient('history-owner');
    const other = await createPatient('history-other');
    const department = await db.getRepository(Department).findOneByOrFail({ code: 'P.102' });
    const visit = await db.getRepository(Visit).save(
      db.getRepository(Visit).create({
        patientId: patient.id,
        hallTicketNumber: 'HISTORY-1',
        clinicTicketNumber: 'CL-HISTORY-1',
        currentDoctorId: doctor.id,
        currentDepartmentId: department.id,
        status: VisitStatus.IN_EXAMINATION,
      }),
    );
    const reExam = await db.getRepository(VisitStep).save(
      db.getRepository(VisitStep).create({
        visitId: visit.id,
        departmentId: department.id,
        isReExam: true,
        status: StepStatus.IN_PROGRESS,
      }),
    );
    const doctorCookie = await cookieFor(doctor);
    const body = {
      icd10Code: 'TEST-E2E',
      icd10Name: 'Synthetic test conclusion',
      doctorNotes: 'Test only',
      revisitDate: '2026-12-20',
      items: [
        {
          medicationName: 'Synthetic medication',
          dosage: '1 test unit',
          route: 'ORAL',
          frequency: 'Once daily',
          durationDays: 3,
          quantity: 3,
          instructions: 'Test only',
        },
      ],
    };
    await request(app.getHttpServer())
      .post(`/api/visits/${visit.id}/conclusion`)
      .set('Cookie', doctorCookie)
      .send(body)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/visits/${visit.id}/conclusion`)
      .set('Cookie', doctorCookie)
      .send(body)
      .expect(409);
    expect((await db.getRepository(Visit).findOneByOrFail({ id: visit.id })).status).toBe(
      VisitStatus.COMPLETED,
    );
    expect((await db.getRepository(VisitStep).findOneByOrFail({ id: reExam.id })).status).toBe(
      StepStatus.COMPLETED,
    );
    expect(await db.getRepository(Prescription).count({ where: { visitId: visit.id } })).toBe(1);
    expect(
      await db
        .getRepository(Notification)
        .count({ where: { visitId: visit.id, type: 'VISIT_COMPLETED', userId: patient.id } }),
    ).toBe(1);
    const list = await request(app.getHttpServer())
      .get('/api/visits/me/history?status=COMPLETED&page=1&pageSize=1')
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].visitId).toBe(visit.id);
    const detail = await request(app.getHttpServer())
      .get(`/api/visits/${visit.id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(detail.body.prescription.items[0].durationDays).toBe(3);
    expect(detail.body.prescription.signedAt).toBeTruthy();
    await request(app.getHttpServer())
      .get(`/api/visits/${visit.id}`)
      .set('Cookie', other.cookie)
      .expect(403);
    const foreign = await request(app.getHttpServer())
      .get('/api/visits/me/history')
      .set('Cookie', other.cookie)
      .expect(200);
    expect(foreign.body.items).toEqual([]);
    await request(app.getHttpServer())
      .get('/api/visits/me/history?pageSize=999')
      .set('Cookie', cookie)
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/visits/me/history')
      .set('Cookie', doctorCookie)
      .expect(403);
  });

  it('rolls back a conclusion and its notification together when audit fails, then permits retry without medication', async () => {
    const { patient } = await createPatient('conclusion-rollback');
    const visit = await db.getRepository(Visit).save(
      db.getRepository(Visit).create({
        patientId: patient.id,
        hallTicketNumber: 'HISTORY-ROLLBACK',
        currentDoctorId: doctor.id,
        status: VisitStatus.IN_EXAMINATION,
      }),
    );
    const cookie = await cookieFor(doctor);
    await db.query(
      `CREATE FUNCTION fail_conclusion_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'CONCLUDE_VISIT' THEN RAISE EXCEPTION 'test conclusion rollback'; END IF; RETURN NEW; END $$`,
    );
    await db.query(
      `CREATE TRIGGER fail_conclusion_audit_trigger BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_conclusion_audit()`,
    );
    try {
      await request(app.getHttpServer())
        .post(`/api/visits/${visit.id}/conclusion`)
        .set('Cookie', cookie)
        .send({ icd10Code: 'TEST', icd10Name: 'Rollback', items: [] })
        .expect(500);
      expect((await db.getRepository(Visit).findOneByOrFail({ id: visit.id })).status).toBe(
        VisitStatus.IN_EXAMINATION,
      );
      expect(await db.getRepository(Prescription).count({ where: { visitId: visit.id } })).toBe(0);
      expect(await db.getRepository(Notification).count({ where: { visitId: visit.id } })).toBe(0);
    } finally {
      await db.query('DROP TRIGGER fail_conclusion_audit_trigger ON audit_logs');
      await db.query('DROP FUNCTION fail_conclusion_audit()');
    }
    await request(app.getHttpServer())
      .post(`/api/visits/${visit.id}/conclusion`)
      .set('Cookie', cookie)
      .send({ icd10Code: 'TEST', icd10Name: 'No medication', items: [] })
      .expect(200);
  });

  it('protects diagnostic ownership and never recalls a concluded visit from repeated result entry', async () => {
    const { patient, cookie } = await createPatient('result-history');
    const other = await createPatient('result-foreign');
    const department = await db.getRepository(Department).findOneByOrFail({ code: 'P.201' });
    const visit = await db.getRepository(Visit).save(
      db.getRepository(Visit).create({
        patientId: patient.id,
        hallTicketNumber: 'RESULT-HISTORY',
        currentDoctorId: doctor.id,
        status: VisitStatus.PARACLINICAL_PENDING,
      }),
    );
    const step = await db.getRepository(VisitStep).save(
      db.getRepository(VisitStep).create({
        visitId: visit.id,
        departmentId: department.id,
        isReExam: false,
        status: StepStatus.PENDING,
      }),
    );
    const lab = await db
      .getRepository(User)
      .findOneByOrFail({ email: 'lab.tech@ezhealthcare.com' });
    const labCookie = await cookieFor(lab);
    const payload = { findings: 'Synthetic test result', isPanicValue: false };
    const result = await request(app.getHttpServer())
      .post(`/api/paraclinical/${step.id}/result`)
      .set('Cookie', labCookie)
      .send(payload)
      .expect(201);
    expect(result.body.autoRecallTriggered).toBe(true);
    await request(app.getHttpServer())
      .get(`/api/paraclinical/${step.id}/result`)
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/paraclinical/${step.id}/result`)
      .set('Cookie', other.cookie)
      .expect(403);
    await db.getRepository(Visit).update(visit.id, { status: VisitStatus.COMPLETED });
    await request(app.getHttpServer())
      .post(`/api/paraclinical/${step.id}/result`)
      .set('Cookie', labCookie)
      .send(payload)
      .expect(409);
    expect((await db.getRepository(Visit).findOneByOrFail({ id: visit.id })).status).toBe(
      VisitStatus.COMPLETED,
    );
  });

  it('scopes completed doctor history to its signer, filters Vietnam completion dates and remains available without a schedule', async () => {
    const users = db.getRepository(User);
    const owner = await users.save(
      users.create({
        email: 'history-signer@example.test',
        name: 'History signer',
        role: Role.DOCTOR,
        isActive: true,
      }),
    );
    const cookie = await cookieFor(owner);
    const { patient, cookie: patientCookie } = await createPatient('doctor-history-100%');
    const visits = db.getRepository(Visit);
    const prescriptions = db.getRepository(Prescription);
    const make = async (signer: User, status: VisitStatus, ticket: string, date: string) => {
      const visit = await visits.save(
        visits.create({
          patientId: patient.id,
          currentDoctorId: signer.id,
          hallTicketNumber: ticket,
          status,
        }),
      );
      const prescription = await prescriptions.save(
        prescriptions.create({
          visitId: visit.id,
          doctorId: signer.id,
          icd10Code: 'TEST-HISTORY',
          icd10Name: 'History test',
        }),
      );
      await db.query('UPDATE prescriptions SET updated_at = $1 WHERE id = $2', [
        date,
        prescription.id,
      ]);
      return visit;
    };
    const own = await make(owner, VisitStatus.COMPLETED, 'HISTORY-OWN', '2026-11-02T17:00:00Z');
    const nextDay = await make(
      owner,
      VisitStatus.COMPLETED,
      'HISTORY-NEXT',
      '2026-11-03T17:00:00Z',
    );
    const foreign = await make(
      doctor,
      VisitStatus.COMPLETED,
      'HISTORY-FOREIGN',
      '2026-11-02T18:00:00Z',
    );
    const unfinished = await make(
      owner,
      VisitStatus.IN_EXAMINATION,
      'HISTORY-ACTIVE',
      '2026-11-02T18:00:00Z',
    );
    const get = (path: string) =>
      request(app.getHttpServer())
        .get('/api/visits/doctor/history' + path)
        .set('Cookie', cookie);
    const list = await get('?completedDate=2026-11-03&search=100%25&pageSize=1').expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].visitId).toBe(own.id);
    expect(JSON.stringify(list.body)).not.toMatch(/password|nationalId|insuranceNumber|email/);
    const all = await get('?pageSize=1&page=2').expect(200);
    expect(all.body.total).toBe(2);
    expect(all.body.items[0].visitId).toBe(own.id);
    const ticket = await get('?search=HISTORY-NEXT').expect(200);
    expect(ticket.body.items.map((item: { visitId: string }) => item.visitId)).toEqual([
      nextDay.id,
    ]);
    const detail = await get('/' + own.id).expect(200);
    expect(detail.body.prescription.icd10Code).toBe('TEST-HISTORY');
    expect(detail.body.prescription.items).toEqual([]);
    await get('/' + foreign.id).expect(404);
    await get('/' + unfinished.id).expect(404);
    for (const query of [
      '?page=0',
      '?pageSize=99',
      '?completedDate=2026-02-30',
      '?doctorId=' + doctor.id,
    ])
      await get(query).expect(400);
    for (const denied of [patientCookie, await cookieFor(nurse), await cookieFor(admin)]) {
      await request(app.getHttpServer())
        .get('/api/visits/doctor/history')
        .set('Cookie', denied)
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/visits/doctor/history/' + own.id)
        .set('Cookie', denied)
        .expect(403);
    }
    await request(app.getHttpServer()).get('/api/visits/doctor/history').expect(401);
  });

  it('preserves doctor room assignments and progressed demo visits when seeding again', async () => {
    const visit = await db
      .getRepository(Visit)
      .findOneByOrFail({ clinicTicketNumber: 'DEMO-CL-003' });
    await db.getRepository(Visit).update(visit.id, { status: VisitStatus.COMPLETED });
    const before = await db.getRepository(QueueTicket).count({ where: { visitId: visit.id } });
    const schedulesBefore = await db.getRepository(DoctorSchedule).find({ order: { id: 'ASC' } });
    await promisify(execFile)(
      process.execPath,
      ['--loader', './esm-loader.mjs', 'dist/database/seeds/seed.js'],
      { env: process.env, timeout: 60000 },
    );
    const saved = await db.getRepository(Visit).findOneByOrFail({ id: visit.id });
    expect(saved.status).toBe(VisitStatus.COMPLETED);
    expect(saved.currentDoctorId).toBe(visit.currentDoctorId);
    expect(saved.currentDepartmentId).toBe(visit.currentDepartmentId);
    expect(await db.getRepository(QueueTicket).count({ where: { visitId: visit.id } })).toBe(
      before,
    );
    for (const old of schedulesBefore) {
      const current = await db.getRepository(DoctorSchedule).findOneByOrFail({ id: old.id });
      expect(current.departmentId).toBe(old.departmentId);
    }
  });

  it('round-trips the latest room schedule and return report migrations without losing seed rows', async () => {
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
        'OneDoctorPerRoomShift1792140000000',
        'PatientReturnReport1792150000000',
      ]);
      expect(Number((await dataSource.query('SELECT COUNT(*) AS count FROM users'))[0].count)).toBe(
        usersBefore,
      );
    } finally {
      await dataSource.destroy();
    }
  });
});
