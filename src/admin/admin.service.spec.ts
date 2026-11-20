import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { Department } from '../department/entities/department.entity';
import { DoctorSchedule } from '../department/entities/doctor-schedule.entity';
import { SystemConfig } from './entities/system-config.entity';
import { User } from '../database/entities/user.entity';
import { AuthSession } from '../auth/entities/auth-session.entity';
import { AuditLog } from '../common/entities/audit-log.entity';
import { TriageRule } from '../triage/entities/triage-rule.entity';
import { Visit } from '../visit/entities/visit.entity';
import { VisitVital } from '../visit/entities/visit-vital.entity';
import { ReceptionEtaForecast } from '../visit/entities/reception-eta-forecast.entity';
import { ReceptionDeskShift } from '../visit/entities/reception-desk-shift.entity';
import { AuditService } from '../common/audit.service';
import { Role } from '../user/enums/role.enum';
import { RoomType } from '../department/enums/room-type.enum';
import { ShiftType } from '../department/enums/shift-type.enum';
import { VisitStatus } from '../visit/enums/visit-status.enum';

describe('AdminService', () => {
  let service: AdminService;

  const mockDepartmentRepo: any = {
    find: jest.fn<any>().mockResolvedValue([
      {
        id: 'dept-1',
        code: 'P.101',
        name: 'Reception',
        roomType: RoomType.RECEPTION,
        floor: 1,
        avgServiceTimeMin: 10,
      },
      {
        id: 'dept-2',
        code: 'P.102',
        name: 'Internal Medicine',
        roomType: RoomType.CONSULTATION,
        floor: 1,
        avgServiceTimeMin: 15,
      },
    ]),
    findOne: jest.fn<any>(),
    create: jest.fn<any>((dto) => dto),
    save: jest.fn<any>((entity) => Promise.resolve({ id: 'dept-1', ...(entity as any) })),
    count: jest.fn<any>().mockResolvedValue(10),
  };

  const mockScheduleRepo: any = {
    find: jest.fn<any>(),
    findOne: jest.fn<any>(),
    create: jest.fn<any>((dto) => dto),
    save: jest.fn<any>((entity) => Promise.resolve({ id: 'sched-1', ...(entity as any) })),
    delete: jest.fn<any>().mockResolvedValue({ affected: 1 }),
    count: jest.fn<any>().mockResolvedValue(5),
    createQueryBuilder: jest.fn<any>(() => ({
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn<any>().mockResolvedValue([]),
    })),
  };

  const mockConfigRepo: any = {
    find: jest.fn<any>().mockResolvedValue([
      {
        id: 'cfg-1',
        configKey: 'BR-QUEUE-PRIORITY',
        configValue: '{"alphaWaitWeight":0.7}',
        version: 1,
      },
    ]),
    findOne: jest.fn<any>(),
    save: jest.fn<any>((entity) => Promise.resolve({ ...(entity as any) })),
  };

  const mockUserRepo: any = {
    find: jest.fn<any>(),
    findOne: jest.fn<any>(),
    create: jest.fn<any>((dto) => dto),
    save: jest.fn<any>((entity) => Promise.resolve({ id: 'user-1', ...(entity as any) })),
    update: jest.fn<any>().mockResolvedValue({ affected: 1 }),
    count: jest.fn<any>().mockResolvedValue(50),
    createQueryBuilder: jest.fn<any>(() => ({
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn<any>().mockResolvedValue([[{ id: 'u1', name: 'Test' }], 1]),
      getRawMany: jest.fn<any>().mockResolvedValue([
        { role: 'DOCTOR', count: '10' },
        { role: 'NURSE', count: '15' },
      ]),
    })),
  };

  const mockSessionRepo: any = {
    update: jest.fn<any>().mockResolvedValue({ affected: 1 }),
  };

  const mockAuditRepo: any = {
    createQueryBuilder: jest.fn<any>(() => ({
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest
        .fn<any>()
        .mockResolvedValue([
          [{ id: 'log-1', action: 'CREATE_STAFF_USER', actorRole: 'ADMIN', createdAt: new Date() }],
          1,
        ]),
    })),
  };

  const mockTriageRuleRepo: any = {
    find: jest.fn<any>().mockResolvedValue([
      {
        id: 'rule-1',
        symptomCode: 'SYM_FEVER',
        symptomName: 'Sốt cao',
        targetDepartmentId: 'dept-2',
        priorityWeight: 3,
      },
    ]),
    findOne: jest.fn<any>(),
    create: jest.fn<any>((dto) => dto),
    save: jest.fn<any>((entity) => Promise.resolve({ id: 'rule-1', ...(entity as any) })),
    delete: jest.fn<any>().mockResolvedValue({ affected: 1 }),
  };

  const mockVisitRepo: any = {
    count: jest.fn<any>().mockResolvedValue(100),
    createQueryBuilder: jest.fn<any>(() => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn<any>().mockResolvedValue([
        {
          id: 'v-1',
          hallTicketNumber: 'T-001',
          clinicTicketNumber: 'K-001',
          status: VisitStatus.COMPLETED,
          patientId: 'p-1',
          initialDepartmentId: 'dept-1',
          currentDepartmentId: 'dept-2',
          patient: { name: 'Nguyen Van A', phone: '0901234567' },
          initialDepartment: { code: 'P.101', name: 'Reception' },
          currentDepartment: { code: 'P.102', name: 'Internal Medicine' },
          vital: { news2Score: 2, news2Risk: 'LOW', isRedFlag: false },
          createdAt: new Date('2026-11-20T08:00:00Z'),
          intakeCompletedAt: new Date('2026-11-20T08:15:00Z'),
        },
      ]),
    })),
  };

  const mockVisitVitalRepo: any = {
    createQueryBuilder: jest.fn<any>(() => ({
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn<any>().mockResolvedValue([
        { id: 'vit-1', news2Score: 2, news2Risk: 'LOW', isRedFlag: false },
        {
          id: 'vit-2',
          news2Score: 7,
          news2Risk: 'HIGH',
          isRedFlag: true,
          redFlagReason: 'Khó thở cấp',
        },
      ]),
    })),
  };

  const mockEtaForecastRepo: any = {
    createQueryBuilder: jest.fn<any>(() => ({
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn<any>().mockResolvedValue([
        {
          ticketId: 't-1',
          queuedAt: new Date('2026-11-20T08:00:00Z'),
          estimatedStartAt: new Date('2026-11-20T08:10:00Z'),
          actualStartedAt: new Date('2026-11-20T08:11:30Z'), // error 1.5 min
        },
      ]),
    })),
  };

  const mockReceptionShiftRepo: any = {
    createQueryBuilder: jest.fn<any>(() => ({
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn<any>().mockResolvedValue([]),
    })),
    findOne: jest.fn<any>(),
    create: jest.fn<any>((dto) => dto),
    save: jest.fn<any>((entity) => Promise.resolve({ id: 'rshift-1', ...(entity as any) })),
    delete: jest.fn<any>().mockResolvedValue({ affected: 1 }),
  };

  const mockAuditService: any = {
    log: jest.fn<any>().mockResolvedValue({ id: 'audit-1' }),
  };

  const adminActor = { id: 'admin-id-1', role: Role.ADMIN };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(Department), useValue: mockDepartmentRepo },
        { provide: getRepositoryToken(DoctorSchedule), useValue: mockScheduleRepo },
        { provide: getRepositoryToken(SystemConfig), useValue: mockConfigRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(AuthSession), useValue: mockSessionRepo },
        { provide: getRepositoryToken(AuditLog), useValue: mockAuditRepo },
        { provide: getRepositoryToken(TriageRule), useValue: mockTriageRuleRepo },
        { provide: getRepositoryToken(Visit), useValue: mockVisitRepo },
        { provide: getRepositoryToken(VisitVital), useValue: mockVisitVitalRepo },
        { provide: getRepositoryToken(ReceptionEtaForecast), useValue: mockEtaForecastRepo },
        { provide: getRepositoryToken(ReceptionDeskShift), useValue: mockReceptionShiftRepo },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listUsers', () => {
    it('returns paginated users with total and pages', async () => {
      const res = await service.listUsers({ page: 1, limit: 10 });
      expect(res.items.length).toBe(1);
      expect(res.total).toBe(1);
      expect(res.page).toBe(1);
      expect(res.limit).toBe(10);
    });
  });

  describe('createStaffUser', () => {
    it('throws ConflictException if email is already registered', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({ id: 'existing', email: 'doc@ez.com' });
      await expect(
        service.createStaffUser(
          {
            email: 'doc@ez.com',
            password: 'Password@123',
            name: 'Dr. John',
            role: Role.DOCTOR,
          },
          adminActor,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('creates and returns staff user without password hash', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      const res = await service.createStaffUser(
        {
          email: 'newdoc@ez.com',
          password: 'Password@123',
          name: 'Dr. New',
          role: Role.DOCTOR,
        },
        adminActor,
      );
      expect(res.email).toBe('newdoc@ez.com');
      expect((res as any).password).toBeUndefined();
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE_STAFF_USER' }),
      );
    });
  });

  describe('toggleUserStatus', () => {
    it('prevents admin from deactivating their own account', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({ id: adminActor.id });
      await expect(service.toggleUserStatus(adminActor.id, false, adminActor)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('revokes active sessions on account deactivation', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({ id: 'staff-2', isActive: true });
      const res = await service.toggleUserStatus('staff-2', false, adminActor);
      expect(res.isActive).toBe(false);
      expect(mockSessionRepo.update).toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('hashes new password and revokes existing sessions', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({ id: 'staff-3', password: 'old' });
      const res = await service.resetPassword(
        'staff-3',
        { newPassword: 'NewPassword@123' },
        adminActor,
      );
      expect(res.message).toBeDefined();
      expect(mockSessionRepo.update).toHaveBeenCalled();
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ADMIN_RESET_PASSWORD' }),
      );
    });
  });

  describe('configs and rules', () => {
    it('updates system config and validates JSON for BR-QUEUE-PRIORITY', async () => {
      mockConfigRepo.findOne.mockResolvedValueOnce({
        id: 'c1',
        configKey: 'BR-QUEUE-PRIORITY',
        configValue: '{}',
        version: 1,
      });

      const res = await service.updateConfig(
        'BR-QUEUE-PRIORITY',
        { configValue: JSON.stringify({ alphaWaitWeight: 0.8 }) },
        adminActor,
      );
      expect(res.version).toBe(2);
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE_SYSTEM_CONFIG' }),
      );
    });

    it('rejects invalid JSON for BR-QUEUE-PRIORITY', async () => {
      mockConfigRepo.findOne.mockResolvedValueOnce({
        id: 'c1',
        configKey: 'BR-QUEUE-PRIORITY',
        configValue: '{}',
        version: 1,
      });

      await expect(
        service.updateConfig('BR-QUEUE-PRIORITY', { configValue: 'not a json' }, adminActor),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a new triage rule', async () => {
      mockTriageRuleRepo.findOne.mockResolvedValueOnce(null);
      mockDepartmentRepo.findOne.mockResolvedValueOnce({ id: 'dept-2', code: 'P.102' });

      const res = await service.createTriageRule(
        {
          symptomCode: 'SYM_COUGH',
          symptomName: 'Ho khan kéo dài',
          targetDepartmentId: 'dept-2',
          priorityWeight: 2,
        },
        adminActor,
      );

      expect(res.symptomCode).toBe('SYM_COUGH');
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE_TRIAGE_RULE' }),
      );
    });
  });

  describe('reports and analytics', () => {
    it('calculates summary with visit status breakdown and STAT count', async () => {
      const summary = await service.getReportSummary({});
      expect(summary.totalVisits).toBe(1);
      expect(summary.uniquePatients).toBe(1);
      expect(summary.byStatus[VisitStatus.COMPLETED]).toBe(1);
    });

    it('evaluates ETA algorithm performance (MAE & accuracy within 3 min)', async () => {
      const eta = await service.getEtaPerformance({});
      expect(eta.evaluatedCount).toBe(1);
      expect(eta.maeMinutes).toBe(1.5);
      expect(eta.within3MinRate).toBe(100);
      expect(eta.distribution.under3Min).toBe(1);
    });

    it('computes triage risk breakdown (NEWS2 & Red flags)', async () => {
      const triage = await service.getTriageRiskReport({});
      expect(triage.totalVitals).toBe(2);
      expect(triage.riskTiers.low.count).toBe(1);
      expect(triage.riskTiers.high.count).toBe(1);
      expect(triage.redFlags.count).toBe(1);
    });

    it('generates Excel-compatible CSV with UTF-8 BOM', async () => {
      const csv = await service.exportReportCsv({});
      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).toContain('Mã Lượt Khám');
      expect(csv).toContain('T-001');
      expect(csv).toContain('Nguyen Van A');
    });
  });

  describe('audit logs', () => {
    it('returns paginated audit trail', async () => {
      const logs = await service.listAuditLogs({ page: 1, limit: 10 });
      expect(logs.items.length).toBe(1);
      expect(logs.total).toBe(1);
    });
  });

  describe('reception desk shifts', () => {
    it('creates a reception shift assignment after verifying role and collision', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: 'rec-1',
        name: 'Le Tan A',
        role: Role.RECEPTIONIST,
      });
      mockReceptionShiftRepo.findOne.mockResolvedValue(null);

      const res = await service.createReceptionShift(
        {
          businessDate: '2026-11-20',
          shiftType: ShiftType.MORNING,
          deskCode: '01',
          receptionistId: 'rec-1',
        },
        adminActor,
      );

      expect(res.deskCode).toBe('01');
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE_RECEPTION_SHIFT' }),
      );
    });
  });
});
