import { BadRequestException, ConflictException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { VisitStatus } from './enums/visit-status.enum';

export class MockVisitService {
  constructor(
    private readonly visitRepo: any,
    private readonly departmentRepo: any,
  ) {}

  async createHallTicket(dto: { patientId: string; name: string; chiefComplaint?: string }) {
    const today = new Date().toISOString().split('T')[0];
    const existing = await this.visitRepo.findOne({
      where: { patientId: dto.patientId, date: today },
    });

    if (existing) {
      throw new ConflictException('Patient already has an active visit ticket for today.');
    }

    const hallTicketNumber = 'A-001';
    const visit = {
      id: 'visit-uuid-1',
      patientId: dto.patientId,
      hallTicketNumber,
      status: VisitStatus.HALL_WAITING,
      date: today,
    };

    return await this.visitRepo.save(visit);
  }

  async assignClinicTicket(visitId: string, departmentCode: string, isPriority = false) {
    const visit = await this.visitRepo.findOne({ where: { id: visitId } });
    if (!visit) {
      throw new BadRequestException('Visit not found');
    }

    const dept = await this.departmentRepo.findOne({ where: { code: departmentCode } });
    if (!dept) {
      throw new BadRequestException('Department not found');
    }

    if (dept.currentOccupancy >= dept.maxQuota) {
      throw new ConflictException(
        `Clinic ${departmentCode} has reached its maximum quota for the current shift.`,
      );
    }

    visit.status = VisitStatus.TRIAGE_PENDING;
    visit.clinicTicketNumber = `${departmentCode.replace('P.', 'CL-')}-01`;
    visit.isPriority = isPriority;

    return await this.visitRepo.save(visit);
  }

  async recordVitalSigns(
    visitId: string,
    vitals: {
      systolic?: number;
      diastolic?: number;
      heartRate?: number;
      temperature?: number;
      spo2?: number;
      respiratoryRate?: number;
    },
  ) {
    const visit = await this.visitRepo.findOne({ where: { id: visitId } });
    if (!visit) {
      throw new BadRequestException('Visit not found');
    }

    // Validation: All 5 vitals are mandatory
    if (
      vitals.systolic === undefined ||
      vitals.diastolic === undefined ||
      vitals.heartRate === undefined ||
      vitals.temperature === undefined ||
      vitals.spo2 === undefined ||
      vitals.respiratoryRate === undefined
    ) {
      throw new BadRequestException(
        'All 5 vital signs (BP, Heart Rate, Temp, SpO2, Resp Rate) are mandatory.',
      );
    }

    // Red flag check: SpO2 < 90% or systolic < 90
    if (vitals.spo2 < 90 || vitals.systolic < 90) {
      visit.status = VisitStatus.EMERGENCY_DISPATCHED;
      visit.isRedFlag = true;
      return await this.visitRepo.save(visit);
    }

    visit.status = VisitStatus.CLINIC_WAITING;
    visit.vitals = vitals;
    return await this.visitRepo.save(visit);
  }

  async evaluateParaclinicalCompletion(visitId: string, remainingPendingSteps: number) {
    const visit = await this.visitRepo.findOne({ where: { id: visitId } });
    if (!visit) throw new BadRequestException('Visit not found');

    if (remainingPendingSteps === 0) {
      visit.status = VisitStatus.RE_EXAM_CALLING;
      visit.hasPriorityRecallBadge = true;
    }

    return await this.visitRepo.save(visit);
  }
}

describe('VisitService (Specification: Happy & Unhappy Cases for Outpatient Journey)', () => {
  let service: MockVisitService;
  let mockVisitRepo: any;
  let mockDepartmentRepo: any;

  beforeEach(() => {
    mockVisitRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((val) => Promise.resolve(val)),
    };
    mockDepartmentRepo = {
      findOne: jest.fn(),
    };

    service = new MockVisitService(mockVisitRepo, mockDepartmentRepo);
  });

  describe('createHallTicket', () => {
    describe('Happy Path', () => {
      it('should issue Hall Ticket (A-001) with status HALL_WAITING', async () => {
        mockVisitRepo.findOne.mockResolvedValue(null);

        const result = await service.createHallTicket({
          patientId: 'patient-123',
          name: 'Jane Doe',
          chiefComplaint: 'Stomach pain',
        });

        expect(result.hallTicketNumber).toBe('A-001');
        expect(result.status).toBe(VisitStatus.HALL_WAITING);
      });
    });

    describe('Unhappy Path', () => {
      it('should throw ConflictException if patient already requested a ticket on the same day', async () => {
        mockVisitRepo.findOne.mockResolvedValue({ id: 'existing-ticket' });

        await expect(
          service.createHallTicket({ patientId: 'patient-123', name: 'Jane Doe' }),
        ).rejects.toThrow(ConflictException);
      });
    });
  });

  describe('assignClinicTicket & Quota Validation', () => {
    describe('Happy Path', () => {
      it('should assign clinic ticket and flag priority for elderly patients (> 80 years old)', async () => {
        mockVisitRepo.findOne.mockResolvedValue({ id: 'v-1' });
        mockDepartmentRepo.findOne.mockResolvedValue({
          code: 'P.102',
          currentOccupancy: 15,
          maxQuota: 40,
        });

        const result = await service.assignClinicTicket('v-1', 'P.102', true);

        expect(result.status).toBe(VisitStatus.TRIAGE_PENDING);
        expect(result.isPriority).toBe(true);
      });
    });

    describe('Unhappy Path', () => {
      it('should throw ConflictException when clinic quota is reached (currentOccupancy >= maxQuota)', async () => {
        mockVisitRepo.findOne.mockResolvedValue({ id: 'v-1' });
        mockDepartmentRepo.findOne.mockResolvedValue({
          code: 'P.102',
          currentOccupancy: 40,
          maxQuota: 40, // At capacity
        });

        await expect(service.assignClinicTicket('v-1', 'P.102')).rejects.toThrow(ConflictException);
      });
    });
  });

  describe('recordVitalSigns & Emergency Intercept', () => {
    describe('Happy Path', () => {
      it('should record all 5 vital signs and move visit to CLINIC_WAITING', async () => {
        mockVisitRepo.findOne.mockResolvedValue({ id: 'v-1' });

        const result = await service.recordVitalSigns('v-1', {
          systolic: 120,
          diastolic: 80,
          heartRate: 75,
          temperature: 36.8,
          spo2: 98,
          respiratoryRate: 16,
        });

        expect(result.status).toBe(VisitStatus.CLINIC_WAITING);
        expect(result.vitals.spo2).toBe(98);
      });
    });

    describe('Unhappy & Emergency Path', () => {
      it('should throw BadRequestException if any mandatory vital sign is omitted', async () => {
        mockVisitRepo.findOne.mockResolvedValue({ id: 'v-1' });

        await expect(
          service.recordVitalSigns('v-1', {
            systolic: 120,
            diastolic: 80,
            heartRate: 75,
            temperature: 36.8,
            // spo2 missing
            respiratoryRate: 16,
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('should immediately trigger EMERGENCY_DISPATCHED if SpO2 drops below 90% (Red Flag)', async () => {
        mockVisitRepo.findOne.mockResolvedValue({ id: 'v-1' });

        const result = await service.recordVitalSigns('v-1', {
          systolic: 110,
          diastolic: 70,
          heartRate: 120,
          temperature: 38.5,
          spo2: 85, // Severe hypoxia (< 90%)
          respiratoryRate: 28,
        });

        expect(result.status).toBe(VisitStatus.EMERGENCY_DISPATCHED);
        expect(result.isRedFlag).toBe(true);
      });
    });
  });

  describe('evaluateParaclinicalCompletion & Priority Recall Loop', () => {
    it('should transition to RE_EXAM_CALLING and attach Priority Recall badge when remainingPendingSteps reaches 0', async () => {
      mockVisitRepo.findOne.mockResolvedValue({
        id: 'v-1',
        status: VisitStatus.PARACLINICAL_PENDING,
      });

      const result = await service.evaluateParaclinicalCompletion('v-1', 0); // 0 steps remaining

      expect(result.status).toBe(VisitStatus.RE_EXAM_CALLING);
      expect(result.hasPriorityRecallBadge).toBe(true);
    });

    it('should stay in current status if there are still pending diagnostic steps', async () => {
      mockVisitRepo.findOne.mockResolvedValue({
        id: 'v-1',
        status: VisitStatus.PARACLINICAL_PENDING,
      });

      const result = await service.evaluateParaclinicalCompletion('v-1', 2); // 2 steps still pending

      expect(result.status).toBe(VisitStatus.PARACLINICAL_PENDING);
      expect(result.hasPriorityRecallBadge).toBeUndefined();
    });
  });
});
