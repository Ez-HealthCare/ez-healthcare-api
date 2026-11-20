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
import { AuditService } from '../common/audit.service';
import { Role } from '../user/enums/role.enum';

describe('AdminService', () => {
  let service: AdminService;

  const mockDepartmentRepo: any = {
    find: jest.fn<any>(),
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
    find: jest.fn<any>().mockResolvedValue([]),
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
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listUsers', () => {
    it('returns paginated users matching query', async () => {
      const result = await service.listUsers({ page: 1, limit: 10, role: Role.DOCTOR });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });
  });

  describe('createStaffUser', () => {
    it('creates a new staff user with hashed password and logs audit', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      const result = await service.createStaffUser(
        {
          name: 'BS. Lê Văn B',
          email: 'doctor.b@hospital.vn',
          password: 'SecretPassword123',
          role: Role.DOCTOR,
          phone: '0987654321',
        },
        adminActor,
      );

      expect(mockUserRepo.findOne).toHaveBeenCalledWith({
        where: { email: 'doctor.b@hospital.vn' },
      });
      expect(mockUserRepo.save).toHaveBeenCalled();
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE_STAFF_USER' }),
      );
      expect(result.email).toBe('doctor.b@hospital.vn');
      expect((result as any).password).toBeUndefined();
    });

    it('throws ConflictException if email is already taken', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: 'existing-id',
        email: 'doctor.b@hospital.vn',
      });

      await expect(
        service.createStaffUser(
          {
            name: 'BS. Lê Văn B',
            email: 'doctor.b@hospital.vn',
            password: 'SecretPassword123',
            role: Role.DOCTOR,
          },
          adminActor,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('toggleUserStatus', () => {
    it('toggles user status and revokes sessions when deactivating', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 'target-staff', isActive: true });

      const result = await service.toggleUserStatus('target-staff', false, adminActor);
      expect(result.isActive).toBe(false);
      expect(mockSessionRepo.update).toHaveBeenCalled();
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEACTIVATE_USER' }),
      );
    });

    it('throws BadRequestException if admin tries to deactivate self', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: adminActor.id, isActive: true });

      await expect(service.toggleUserStatus(adminActor.id, false, adminActor)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('resetPassword', () => {
    it('hashes new password, updates user and revokes active sessions', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 'user-2', email: 'staff@hospital.vn' });

      const result = await service.resetPassword(
        'user-2',
        { newPassword: 'BrandNewPass123' },
        adminActor,
      );
      expect(result.message).toContain('thành công');
      expect(mockUserRepo.update).toHaveBeenCalled();
      expect(mockSessionRepo.update).toHaveBeenCalled();
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ADMIN_RESET_PASSWORD' }),
      );
    });
  });

  describe('getAdminStats', () => {
    it('returns aggregated system counts', async () => {
      const stats = await service.getAdminStats();
      expect(stats.users.total).toBe(50);
      expect(stats.departments.total).toBe(10);
      expect(stats.schedules.total).toBe(5);
    });
  });
});
