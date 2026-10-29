import 'reflect-metadata';
import { jest } from '@jest/globals';
import { User } from '../database/entities/user.entity';
import { Department } from '../department/entities/department.entity';
import { RoomType } from '../department/enums/room-type.enum';
import { Role } from '../user/enums/role.enum';
import { ROLES_KEY } from '../common/constants/auth.constants';
import { BUSINESS_WINDOWS, DEPARTMENT_CODES } from '../common/constants/clinical.constants';
import { SEED_DEPARTMENTS } from '../common/constants/seed.constants';
import { QueueTicket } from './entities/queue-ticket.entity';
import { VisitVital } from './entities/visit-vital.entity';
import { Visit } from './entities/visit.entity';
import { VisitStatus } from './enums/visit-status.enum';
import { ReceptionService } from './reception.service';
import { QueueTicketService } from './queue-ticket.service';
import { VisitController } from './visit.controller';

const normal = {
  chiefComplaint: 'Headache',
  bloodPressureSystolic: 120,
  bloodPressureDiastolic: 80,
  heartRate: 75,
  temperature: 37,
  spo2: 98,
  respiratoryRate: 16,
};
const actor = { id: 'nurse', role: Role.NURSE };

function setup(departmentCode = 'NO') {
  const patient = { id: 'patient', name: 'Patient', allergies: [] };
  const visit = Object.assign(new Visit(), {
    id: 'visit',
    patientId: patient.id,
    patient,
    status: VisitStatus.TRIAGE_PENDING,
    hallTicketNumber: 'A-001',
    isPriority: true,
    createdAt: new Date(),
  });
  const department = {
    id: 'clinic',
    code: departmentCode,
    name: 'Nội',
    isActive: true,
    roomType: RoomType.CONSULTATION,
    maxQuotaPerSlot: 50,
  };
  const save = jest.fn(async (value: any) => value);
  const visitRepo = { save, find: jest.fn(async () => [visit]) };
  const vitalRepo = { save, findOne: async () => null, create: (value: any) => value };
  const ticketRepo = { save, create: (value: any) => value, update: jest.fn(async () => ({})) };
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === Visit) return visitRepo;
      if (entity === VisitVital) return vitalRepo;
      if (entity === QueueTicket) return ticketRepo;
      if (entity === User) return { save, findOne: async () => patient };
      if (entity === Department)
        return {
          findOne: async ({ where }: any) =>
            where.code === 'P.001' ? { id: 'emergency', code: 'P.001' } : department,
        };
      return { find: async () => [] };
    },
    query: async () => [{ count: 0 }],
  };
  const queue = {
    transaction: async (callback: any) => callback(manager),
    lockVisit: async () => visit,
    requireIdempotencyKey: (key: string) => key,
    requireIssuanceWindow: () => ({ businessDate: '2026-10-28', expiresAt: new Date() }),
    fingerprint: () => 'fingerprint',
    runIdempotent: async (_key: string, _context: unknown, callback: any) => callback(manager),
    nextSequence: async () => 1,
    displayNumber: QueueTicketService.prototype.displayNumber,
    ticketResponse: (value: Visit) => ({ visitId: value.id, status: value.status }),
  };
  const service = new ReceptionService(
    ticketRepo as any,
    visitRepo as any,
    queue as any,
    { queueIssuanceWindows: BUSINESS_WINDOWS } as any,
    { create: jest.fn(async () => ({})) } as any,
    { log: jest.fn(async () => ({})) } as any,
  );
  return { service, visit, visitRepo, save };
}

it('N01: loads triage visits independently of completed hall tickets, with priority ordering', async () => {
  const { service, visitRepo } = setup();
  expect(await service.getTriageQueue()).toEqual([
    expect.objectContaining({
      visitId: 'visit',
      hallTicketNumber: 'A-001',
      intakeCompleted: false,
      patient: expect.objectContaining({ name: 'Patient' }),
      isPriority: true,
      vital: null,
    }),
  ]);
  expect(visitRepo.find).toHaveBeenCalledWith({
    where: { status: VisitStatus.TRIAGE_PENDING },
    relations: { patient: true, vital: true, currentDepartment: true },
    order: { isPriority: 'DESC', createdAt: 'ASC' },
  });
  expect(Reflect.getMetadata(ROLES_KEY, VisitController.prototype.getTriageQueue)).toEqual([
    Role.NURSE,
    Role.ADMIN,
  ]);
});

it('N02, N03, N05: blocks assignment until intake, then issues a clinic ticket', async () => {
  const { service, visit } = setup();
  await expect(
    service.assignClinic(visit.id, { departmentCode: 'NO' }, actor, 'key'),
  ).rejects.toMatchObject({ response: { code: 'VISIT_STATE_CONFLICT' }, status: 409 });
  await service.recordIntake(visit.id, normal, actor);
  expect(visit.intakeCompletedAt).toBeInstanceOf(Date);
  expect((await service.getTriageQueue())[0].intakeCompleted).toBe(true);
  await service.assignClinic(visit.id, { departmentCode: 'NO' }, actor, 'key');
  expect(visit.status).toBe(VisitStatus.CLINIC_WAITING);
  expect(visit.clinicTicketNumber).toBe('NO-01');
  expect(visit.currentDepartmentId).toBe('clinic');
});

it.each([
  { spo2: 85 },
  { bloodPressureSystolic: 80 },
  { respiratoryRate: 25, heartRate: 135, temperature: 39.5 },
])(
  'N04: dispatches critical intake to P.001 and blocks ordinary assignment: %j',
  async (vitals) => {
    const { service, visit } = setup();
    const result = await service.recordIntake(visit.id, { ...normal, ...vitals }, actor);
    expect(result.isRedFlag).toBe(true);
    expect(visit.status).toBe(VisitStatus.EMERGENCY_DISPATCHED);
    expect(visit.currentDepartmentId).toBe('emergency');
    await expect(
      service.assignClinic(visit.id, { departmentCode: 'NO' }, actor, 'key'),
    ).rejects.toMatchObject({ status: 409 });
  },
);

it.each([
  DEPARTMENT_CODES.PULMONOLOGY,
  DEPARTMENT_CODES.CARDIOLOGY,
  DEPARTMENT_CODES.NEPHROLOGY,
  DEPARTMENT_CODES.GERIATRICS,
])('N05: seeds and assigns specialty %s with its own clinic ticket', async (code) => {
  expect(SEED_DEPARTMENTS.find((department) => department.code === code)).toMatchObject({
    roomType: RoomType.CONSULTATION,
    avgServiceTimeMin: 15,
    maxQuotaPerSlot: 35,
  });
  const { service, visit } = setup(code);
  await service.recordIntake(visit.id, normal, actor);
  const result = await service.assignClinic(visit.id, { departmentCode: code }, actor, 'key');
  expect(result).toMatchObject({ departmentCode: code });
  expect(visit.status).toBe(VisitStatus.CLINIC_WAITING);
  expect(visit.clinicTicketNumber).toBe(`CL-${code.slice(2)}-01`);
});

it.each([
  normal,
  {
    ...normal,
    chiefComplaint: 'Khởi phát đột ngột méo miệng, liệt yếu nửa người trái, nói ngọng khó hiểu',
    bloodPressureSystolic: 170,
    bloodPressureDiastolic: 95,
    heartRate: 92,
    temperature: 37,
    spo2: 97,
    respiratoryRate: 18,
  },
])('N07: F.A.S.T dispatches to STAT P.001 even with low NEWS2: %j', async (vitals) => {
  const { service, visit } = setup();
  const redFlagReason = 'Cờ đỏ F.A.S.T: Nghi ngờ đột quỵ não cấp (giờ vàng)';
  const result = await service.recordIntake(
    visit.id,
    { ...vitals, isRedFlag: true, redFlagReason },
    actor,
  );
  expect(result.vital.news2Score).toBeLessThan(7);
  expect(result.vital.isRedFlag).toBe(true);
  expect(result.vital.redFlagReason).toBe(redFlagReason);
  expect(result.status).toBe(VisitStatus.EMERGENCY_DISPATCHED);
  expect(visit.currentDepartmentId).toBe('emergency');
  expect(visit.isPriority).toBe(true);
  expect(visit.priorityReason).toBe(redFlagReason);
  await expect(
    service.assignClinic(visit.id, { departmentCode: DEPARTMENT_CODES.GERIATRICS }, actor, 'key'),
  ).rejects.toMatchObject({ response: { code: 'VISIT_STATE_CONFLICT' }, status: 409 });
});
