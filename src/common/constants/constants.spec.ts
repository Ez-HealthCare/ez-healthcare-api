import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  OTP_MIN_VALUE,
  OTP_MAX_EXCLUSIVE,
  OTP_PATTERN,
  REFRESH_TOKEN_BYTES,
  REFRESH_TOKEN_PATTERN,
} from './auth.constants';
import { DEPARTMENT_CODES } from './clinical.constants';
import { SEED_DEPARTMENTS, SEED_RULES } from './seed.constants';
import { TriageDagService } from '../../triage/triage-dag.service';
import { TriageController } from '../../triage/triage.controller';
import { checkAllergyConflict } from '../../visit/visit.service';
import { VisitStatus } from '../../visit/enums/visit-status.enum';

function clinicalService(redFlag = false) {
  const visit = {
    id: 'visit-1',
    status: VisitStatus.IN_EXAMINATION,
    vital: {},
    initialDepartment: null,
    initialDepartmentId: 'clinic-1',
    currentDepartmentId: '',
    currentDoctorId: 'doctor-1',
  };
  const departments = Object.values(DEPARTMENT_CODES).map((code) => ({ id: code, code }));
  const savedSteps: any[] = [];
  const rules = { find: async () => (redFlag ? [{ symptomCode: 'STAT' }] : []) };
  const service = new TriageDagService(
    { findOne: async () => visit, save: async (value: any) => value } as any,
    {
      findOne: async () => null,
      create: (value: any) => value,
      save: async (value: any) => ({ id: 'order-1', ...value }),
    } as any,
    {
      delete: async () => undefined,
      create: (value: any) => value,
      save: async (value: any) => {
        if (!value.id) {
          value.id = 'step-' + savedSteps.length;
          savedSteps.push(value);
        }
        return value;
      },
    } as any,
    {
      find: async () => departments,
      findOne: async ({ where }: any) => departments.find((dept) => dept.code === where.code),
    } as any,
    rules as any,
  );
  return { service, visit };
}

describe('Extracted constants used by production code', () => {
  it('keeps generated OTP/refresh tokens compatible with their validators', () => {
    expect([OTP_MIN_VALUE, OTP_MAX_EXCLUSIVE]).toEqual([100000, 1000000]);
    expect(OTP_PATTERN.test(String(randomInt(OTP_MIN_VALUE, OTP_MAX_EXCLUSIVE)))).toBe(true);
    expect(OTP_PATTERN.test('12345')).toBe(false);
    expect(OTP_PATTERN.test('abcdef')).toBe(false);
    const token = randomUUID() + '.' + randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    expect(REFRESH_TOKEN_PATTERN.test(token)).toBe(true);
    expect(REFRESH_TOKEN_PATTERN.test(token + 'x')).toBe(false);
  });

  it('keeps seed department references valid and production allergy lookup intact', () => {
    const seedCodes = new Set(SEED_DEPARTMENTS.map((dept) => dept.code));
    expect(seedCodes.size).toBe(9);
    for (const code of Object.values(DEPARTMENT_CODES)) expect(seedCodes.has(code)).toBe(true);
    for (const rule of SEED_RULES) expect(seedCodes.has(rule.targetDeptCode)).toBe(true);
    expect(checkAllergyConflict('Amoxicillin 500mg', ['Penicillin'])).toBe('Penicillin');
    expect(checkAllergyConflict('Ibuprofen', ['aspirin'])).toBe('aspirin');
    expect(checkAllergyConflict('Paracetamol', ['Penicillin'])).toBeNull();
  });

  it('uses production DAG fallback clinic and ultrasound-before-urinalysis rule', async () => {
    const { service } = clinicalService();
    const result = await service.processClinicalOrders('visit-1', 'doctor-1', {
      orders: ['P.203', 'P.104'],
    });
    expect(result.sortedOrder).toEqual(['P.104', 'P.203', 'P.102']);
  });

  it('preserves production radiation rejection and emergency destination', async () => {
    const routine = clinicalService();
    await expect(
      routine.service.processClinicalOrders('visit-1', 'doctor-1', {
        orders: ['P.302'],
        pregnancySuspected: true,
      }),
    ).rejects.toThrow('RADIATION HAZARD');
    const emergency = clinicalService(true);
    const result = await emergency.service.processClinicalOrders('visit-1', 'doctor-1', {
      orders: [],
      symptoms: ['STAT'],
    });
    expect(result.destinationRoom).toBe('P.001');
    expect(emergency.visit.currentDepartmentId).toBe('P.001');
  });

  it('uses the same fallback department and elderly threshold in triage recommendations', async () => {
    const controller = new TriageController(
      { find: async () => [] } as any,
      { findOne: async ({ where }: any) => ({ code: where.code }) } as any,
    );
    expect((await controller.recommend({ symptoms: [], age: 79 })).isElderlyPriority).toBe(false);
    const result = await controller.recommend({ symptoms: [], age: 80 });
    expect(result.isElderlyPriority).toBe(true);
    expect(result.recommendedDepartment?.code).toBe('P.102');
  });
});
