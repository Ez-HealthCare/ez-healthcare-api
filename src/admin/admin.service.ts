import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, QueryFailedError, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Role } from '../user/enums/role.enum';
import { RoomType } from '../department/enums/room-type.enum';
import { VisitStatus } from '../visit/enums/visit-status.enum';
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
import { CreateDepartmentDto } from './dto/create-department.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';
import { UpdateStaffUserDto } from './dto/update-staff-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { AdminReportsQueryDto } from './dto/admin-reports-query.dto';
import { AdminAuditQueryDto } from './dto/admin-audit-query.dto';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';
import { CreateTriageRuleDto } from './dto/create-triage-rule.dto';
import { UpdateTriageRuleDto } from './dto/update-triage-rule.dto';
import { CreateReceptionShiftDto } from './dto/create-reception-shift.dto';

type Actor = { id: string; role: Role };

function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Department)
    private readonly departmentRepository: Repository<Department>,
    @InjectRepository(DoctorSchedule)
    private readonly scheduleRepository: Repository<DoctorSchedule>,
    @InjectRepository(SystemConfig)
    private readonly configRepository: Repository<SystemConfig>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(AuthSession)
    private readonly sessionRepository: Repository<AuthSession>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    @InjectRepository(TriageRule)
    private readonly triageRuleRepository: Repository<TriageRule>,
    @InjectRepository(Visit)
    private readonly visitRepository: Repository<Visit>,
    @InjectRepository(VisitVital)
    private readonly visitVitalRepository: Repository<VisitVital>,
    @InjectRepository(ReceptionEtaForecast)
    private readonly etaForecastRepository: Repository<ReceptionEtaForecast>,
    @InjectRepository(ReceptionDeskShift)
    private readonly receptionShiftRepository: Repository<ReceptionDeskShift>,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------
  // USER MANAGEMENT
  // ---------------------------------------------------------

  async listUsers(query: AdminUsersQueryDto) {
    const qb = this.userRepository.createQueryBuilder('user');

    if (query.search?.trim()) {
      const term = `%${query.search.trim()}%`;
      qb.andWhere(
        '(user.name ILIKE :term OR user.email ILIKE :term OR user.phone ILIKE :term OR user.nationalId ILIKE :term)',
        { term },
      );
    }

    if (query.role) {
      qb.andWhere('user.role = :role', { role: query.role });
    }

    if (query.isActive !== undefined) {
      qb.andWhere('user.isActive = :isActive', { isActive: query.isActive });
    }

    qb.orderBy('user.createdAt', 'DESC');

    const page = query.page || 1;
    const limit = query.limit || 20;
    qb.skip((page - 1) * limit).take(limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async createStaffUser(dto: CreateStaffUserDto, actor: Actor) {
    const email = dto.email.trim().toLowerCase();

    const existingEmail = await this.userRepository.findOne({ where: { email } });
    if (existingEmail) {
      throw new ConflictException(`Email ${email} đã được sử dụng.`);
    }

    if (dto.phone?.trim()) {
      const phone = dto.phone.trim();
      const existingPhone = await this.userRepository.findOne({ where: { phone } });
      if (existingPhone) {
        throw new ConflictException(`Số điện thoại ${phone} đã được sử dụng.`);
      }
    }

    if (dto.nationalId?.trim()) {
      const nationalId = dto.nationalId.trim();
      const existingNationalId = await this.userRepository.findOne({ where: { nationalId } });
      if (existingNationalId) {
        throw new ConflictException(`CCCD/CMND ${nationalId} đã tồn tại trong hệ thống.`);
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(dto.password, salt);

    const user = this.userRepository.create({
      email,
      password: hashedPassword,
      name: dto.name.trim(),
      role: dto.role,
      phone: dto.phone?.trim() || null,
      nationalId: dto.nationalId?.trim() || null,
      gender: dto.gender || null,
      isActive: true,
    } as Partial<User>) as User;

    const saved = await this.userRepository.save(user);

    await this.audit.log({
      action: 'CREATE_STAFF_USER',
      actorId: actor.id,
      actorRole: actor.role,
      targetEntityType: 'User',
      targetEntityId: saved.id,
      metadata: {
        email: saved.email,
        role: saved.role,
        name: saved.name,
      },
    });

    // Exclude password from return
    const result = { ...saved } as Partial<User>;
    delete result.password;
    return result;
  }

  async getUserById(id: string) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`Không tìm thấy người dùng với ID ${id}`);
    const result = { ...user } as Partial<User>;
    delete result.password;
    return result;
  }

  async updateStaffUser(id: string, dto: UpdateStaffUserDto, actor: Actor) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`Không tìm thấy người dùng với ID ${id}`);

    if (dto.phone?.trim() && dto.phone.trim() !== user.phone) {
      const phone = dto.phone.trim();
      const existing = await this.userRepository.findOne({ where: { phone } });
      if (existing && existing.id !== id) {
        throw new ConflictException(`Số điện thoại ${phone} đã được sử dụng bởi người dùng khác.`);
      }
      user.phone = phone;
    }

    if (dto.nationalId?.trim() && dto.nationalId.trim() !== user.nationalId) {
      const nationalId = dto.nationalId.trim();
      const existing = await this.userRepository.findOne({ where: { nationalId } });
      if (existing && existing.id !== id) {
        throw new ConflictException(`CCCD/CMND ${nationalId} đã tồn tại trong hệ thống.`);
      }
      user.nationalId = nationalId;
    }

    if (dto.name?.trim()) user.name = dto.name.trim();
    if (dto.role) user.role = dto.role;
    if (dto.gender !== undefined) user.gender = dto.gender;
    if (dto.isActive !== undefined) user.isActive = dto.isActive;

    const saved = await this.userRepository.save(user);

    await this.audit.log({
      action: 'UPDATE_STAFF_USER',
      actorId: actor.id,
      actorRole: actor.role,
      targetEntityType: 'User',
      targetEntityId: user.id,
      metadata: {
        updates: dto,
      },
    });

    const result = { ...saved } as Partial<User>;
    delete result.password;
    return result;
  }

  async toggleUserStatus(id: string, isActive: boolean, actor: Actor) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`Không tìm thấy người dùng với ID ${id}`);

    if (user.id === actor.id && !isActive) {
      throw new BadRequestException(
        'Quản trị viên không thể tự vô hiệu hóa tài khoản của chính mình.',
      );
    }

    user.isActive = isActive;
    await this.userRepository.save(user);

    if (!isActive) {
      await this.sessionRepository.update(
        { userId: id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
    }

    await this.audit.log({
      action: 'TOGGLE_USER_STATUS',
      actorId: actor.id,
      actorRole: actor.role,
      targetEntityType: 'User',
      targetEntityId: user.id,
      metadata: { isActive },
    });

    return {
      message: isActive
        ? 'Đã kích hoạt tài khoản'
        : 'Đã vô hiệu hóa tài khoản và thu hồi phiên đăng nhập',
      id: user.id,
      isActive: user.isActive,
    };
  }

  async resetPassword(id: string, dto: ResetPasswordDto, actor: Actor) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`Không tìm thấy người dùng với ID ${id}`);

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(dto.newPassword, salt);
    await this.userRepository.save(user);

    await this.sessionRepository.update(
      { userId: id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    await this.audit.log({
      action: 'ADMIN_RESET_PASSWORD',
      actorId: actor.id,
      actorRole: actor.role,
      targetEntityType: 'User',
      targetEntityId: user.id,
      metadata: { resetBy: actor.id },
    });

    return { message: 'Đổi mật khẩu thành công và đã thu hồi tất cả phiên làm việc cũ.' };
  }

  // ---------------------------------------------------------
  // DEPARTMENT MANAGEMENT
  // ---------------------------------------------------------

  async listDepartments() {
    return await this.departmentRepository.find({
      order: { floor: 'ASC', code: 'ASC' },
    });
  }

  async createDepartment(dto: CreateDepartmentDto) {
    const existing = await this.departmentRepository.findOne({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException(`Phòng khám với mã ${dto.code} đã tồn tại trong danh mục.`);
    }

    const dept = this.departmentRepository.create({
      code: dto.code,
      name: dto.name,
      roomType: dto.roomType,
      floor: dto.floor ?? 1,
      avgServiceTimeMin: dto.avgServiceTimeMin ?? 15,
      maxQuotaPerSlot: dto.maxQuotaPerSlot ?? 40,
      isActive: true,
    });

    return await this.departmentRepository.save(dept);
  }

  async updateDepartment(id: string, dto: UpdateDepartmentDto, actor: Actor) {
    const dept = await this.departmentRepository.findOne({ where: { id } });
    if (!dept) throw new NotFoundException(`Không tìm thấy phòng khoa với ID ${id}`);

    if (dto.name?.trim()) dept.name = dto.name.trim();
    if (dto.roomType) dept.roomType = dto.roomType;
    if (dto.floor !== undefined) dept.floor = dto.floor;
    if (dto.avgServiceTimeMin !== undefined) dept.avgServiceTimeMin = dto.avgServiceTimeMin;
    if (dto.maxQuotaPerSlot !== undefined) dept.maxQuotaPerSlot = dto.maxQuotaPerSlot;
    if (dto.isActive !== undefined) dept.isActive = dto.isActive;

    const saved = await this.departmentRepository.save(dept);

    await this.audit.log({
      action: 'UPDATE_DEPARTMENT',
      actorId: actor.id,
      actorRole: actor.role,
      targetEntityType: 'Department',
      targetEntityId: dept.id,
      metadata: { updates: dto },
    });

    return saved;
  }

  // ---------------------------------------------------------
  // SCHEDULE MANAGEMENT
  // ---------------------------------------------------------

  async listSchedules(shiftDate?: string, departmentCode?: string) {
    const qb = this.scheduleRepository
      .createQueryBuilder('schedule')
      .innerJoinAndSelect('schedule.doctor', 'doctor')
      .innerJoinAndSelect('schedule.department', 'department');

    if (shiftDate) {
      qb.andWhere('schedule.shiftDate = :shiftDate', { shiftDate });
    }

    if (departmentCode) {
      qb.andWhere('department.code = :code', { code: departmentCode });
    }

    qb.orderBy('schedule.shiftDate', 'ASC');
    qb.addOrderBy('department.code', 'ASC');

    return await qb.getMany();
  }

  async createSchedule(dto: CreateScheduleDto) {
    const dept = await this.departmentRepository.findOne({
      where: { code: dto.departmentCode },
    });
    if (!dept) throw new NotFoundException(`Department ${dto.departmentCode} not found.`);

    if (dept.roomType !== RoomType.CONSULTATION) {
      throw new BadRequestException(
        'Bác sĩ chỉ có thể được xếp lịch vào Phòng Khám bệnh (CONSULTATION).',
      );
    }

    const doctor = await this.userRepository.findOne({
      where: { id: dto.doctorId, role: Role.DOCTOR },
    });
    if (!doctor)
      throw new NotFoundException(
        `Doctor with ID ${dto.doctorId} not found or role is not DOCTOR.`,
      );

    const collision = await this.scheduleRepository.findOne({
      where: {
        doctorId: dto.doctorId,
        shiftDate: new Date(dto.shiftDate),
        shiftType: dto.shiftType,
      },
    });

    if (collision) {
      throw new ConflictException(
        `Schedule collision: Doctor already assigned to clinic during the ${dto.shiftType} shift on this date.`,
      );
    }

    const roomCollision = await this.scheduleRepository.findOne({
      where: {
        departmentId: dept.id,
        shiftDate: new Date(dto.shiftDate),
        shiftType: dto.shiftType,
      },
    });
    if (roomCollision)
      throw new ConflictException('Room already has a doctor assigned for this date and shift.');

    const schedule = this.scheduleRepository.create({
      doctorId: dto.doctorId,
      departmentId: dept.id,
      shiftDate: new Date(dto.shiftDate),
      shiftType: dto.shiftType,
      maxQuota: dto.maxQuota || 40,
    });

    try {
      return await this.scheduleRepository.save(schedule);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      ) {
        throw new ConflictException(
          'Doctor or room has already been assigned for this date and shift.',
        );
      }
      throw error;
    }
  }

  async deleteSchedule(id: string, actor: Actor) {
    const schedule = await this.scheduleRepository.findOne({
      where: { id },
      relations: { department: true },
    });
    if (!schedule) throw new NotFoundException(`Không tìm thấy lịch trực với ID ${id}`);

    await this.scheduleRepository.delete(id);

    await this.audit.log({
      action: 'DELETE_SCHEDULE',
      actorId: actor.id,
      actorRole: actor.role,
      targetEntityType: 'DoctorSchedule',
      targetEntityId: id,
      metadata: {
        doctorId: schedule.doctorId,
        departmentCode: schedule.department?.code,
        shiftDate: schedule.shiftDate,
        shiftType: schedule.shiftType,
      },
    });

    return { message: 'Đã hủy phân công ca trực.', id };
  }

  // ---------------------------------------------------------
  // RECEPTION DESK SHIFTS
  // ---------------------------------------------------------

  async listReceptionShifts(businessDate?: string) {
    const qb = this.receptionShiftRepository
      .createQueryBuilder('shift')
      .innerJoinAndSelect('shift.receptionist', 'receptionist');

    if (businessDate) {
      qb.andWhere('shift.businessDate = :businessDate', { businessDate });
    }

    qb.orderBy('shift.businessDate', 'DESC');
    qb.addOrderBy('shift.deskCode', 'ASC');

    return await qb.getMany();
  }

  async createReceptionShift(dto: CreateReceptionShiftDto, actor: Actor) {
    const staff = await this.userRepository.findOne({
      where: { id: dto.receptionistId, role: Role.RECEPTIONIST },
    });
    if (!staff) {
      throw new NotFoundException(
        `Nhân viên lễ tân với ID ${dto.receptionistId} không tồn tại hoặc không có role RECEPTIONIST.`,
      );
    }

    const deskCollision = await this.receptionShiftRepository.findOne({
      where: {
        businessDate: dto.businessDate,
        shiftType: dto.shiftType,
        deskCode: dto.deskCode,
      },
    });
    if (deskCollision) {
      throw new ConflictException(
        `Quầy ${dto.deskCode} đã được phân công cho nhân viên khác trong ca ${dto.shiftType} ngày ${dto.businessDate}.`,
      );
    }

    const staffCollision = await this.receptionShiftRepository.findOne({
      where: {
        businessDate: dto.businessDate,
        shiftType: dto.shiftType,
        receptionistId: dto.receptionistId,
      },
    });
    if (staffCollision) {
      throw new ConflictException(
        `Lễ tân ${staff.name} đã có lịch trực tại quầy ${staffCollision.deskCode} trong ca này.`,
      );
    }

    const shift = this.receptionShiftRepository.create({
      businessDate: dto.businessDate,
      shiftType: dto.shiftType,
      deskCode: dto.deskCode,
      receptionistId: dto.receptionistId,
      acceptingCalls: dto.acceptingCalls !== undefined ? dto.acceptingCalls : true,
    });

    const saved = await this.receptionShiftRepository.save(shift);

    await this.audit.log({
      action: 'CREATE_RECEPTION_SHIFT',
      actorId: actor.id,
      actorRole: actor.role,
      targetEntityType: 'ReceptionDeskShift',
      targetEntityId: saved.id,
      metadata: {
        deskCode: saved.deskCode,
        shiftType: saved.shiftType,
        businessDate: saved.businessDate,
        receptionistName: staff.name,
      },
    });

    return saved;
  }

  async deleteReceptionShift(id: string, actor: Actor) {
    const shift = await this.receptionShiftRepository.findOne({
      where: { id },
      relations: { receptionist: true },
    });
    if (!shift) throw new NotFoundException(`Không tìm thấy ca trực quầy với ID ${id}`);

    await this.receptionShiftRepository.delete(id);

    await this.audit.log({
      action: 'DELETE_RECEPTION_SHIFT',
      actorId: actor.id,
      actorRole: actor.role,
      targetEntityType: 'ReceptionDeskShift',
      targetEntityId: id,
      metadata: {
        deskCode: shift.deskCode,
        businessDate: shift.businessDate,
        shiftType: shift.shiftType,
      },
    });

    return { message: 'Đã hủy phân công ca trực quầy.', id };
  }

  // ---------------------------------------------------------
  // STATS & CONFIGS
  // ---------------------------------------------------------

  async getAdminStats() {
    const [totalUsers, activeUsers, roleCounts] = await Promise.all([
      this.userRepository.count(),
      this.userRepository.count({ where: { isActive: true } }),
      this.userRepository
        .createQueryBuilder('user')
        .select('user.role', 'role')
        .addSelect('COUNT(*)', 'count')
        .groupBy('user.role')
        .getRawMany(),
    ]);

    const byRole: Record<string, number> = {};
    roleCounts.forEach((r) => {
      byRole[r.role] = parseInt(r.count, 10);
    });

    const [totalDepartments, activeDepartments, totalSchedules, totalVisits] = await Promise.all([
      this.departmentRepository.count(),
      this.departmentRepository.count({ where: { isActive: true } }),
      this.scheduleRepository.count(),
      this.visitRepository.count(),
    ]);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        byRole,
      },
      departments: {
        total: totalDepartments,
        active: activeDepartments,
      },
      schedules: {
        total: totalSchedules,
      },
      visits: {
        total: totalVisits,
      },
    };
  }

  async getConfigs() {
    return await this.configRepository.find({ order: { configKey: 'ASC' } });
  }

  async updateConfig(key: string, dto: UpdateSystemConfigDto, actor: Actor) {
    const config = await this.configRepository.findOne({ where: { configKey: key } });
    if (!config) throw new NotFoundException(`Cấu hình hệ thống với khóa ${key} không tồn tại.`);

    // If queue priority config, validate that string is valid JSON with positive numbers
    if (key === 'BR-QUEUE-PRIORITY') {
      try {
        const parsed = JSON.parse(dto.configValue);
        if (typeof parsed !== 'object' || parsed === null) {
          throw new BadRequestException(
            'Giá trị cấu hình BR-QUEUE-PRIORITY phải là đối tượng JSON hợp lệ.',
          );
        }
      } catch (err: any) {
        throw new BadRequestException(`Cấu hình JSON không hợp lệ: ${err.message}`);
      }
    }

    config.configValue = dto.configValue;
    if (dto.description !== undefined) config.description = dto.description;
    config.version = (config.version || 1) + 1;

    const saved = await this.configRepository.save(config);

    await this.audit.log({
      action: 'UPDATE_SYSTEM_CONFIG',
      actorId: actor.id,
      actorRole: actor.role,
      targetEntityType: 'SystemConfig',
      targetEntityId: config.id,
      metadata: {
        configKey: key,
        version: config.version,
      },
    });

    return saved;
  }

  // ---------------------------------------------------------
  // TRIAGE RULES MANAGEMENT
  // ---------------------------------------------------------

  async listTriageRules() {
    return await this.triageRuleRepository.find({
      relations: { targetDepartment: true },
      order: { priorityWeight: 'DESC', symptomCode: 'ASC' },
    });
  }

  async createTriageRule(dto: CreateTriageRuleDto, actor: Actor) {
    const existing = await this.triageRuleRepository.findOne({
      where: { symptomCode: dto.symptomCode.trim().toUpperCase() },
    });
    if (existing) {
      throw new ConflictException(`Mã triệu chứng sàng lọc ${dto.symptomCode} đã tồn tại.`);
    }

    const dept = await this.departmentRepository.findOne({
      where: { id: dto.targetDepartmentId },
    });
    if (!dept) {
      throw new NotFoundException(
        `Phòng khám chỉ định với ID ${dto.targetDepartmentId} không tồn tại.`,
      );
    }

    const rule = this.triageRuleRepository.create({
      symptomCode: dto.symptomCode.trim().toUpperCase(),
      symptomName: dto.symptomName.trim(),
      targetDepartmentId: dto.targetDepartmentId,
      isRedFlag: dto.isRedFlag || false,
      contraindicationTags: dto.contraindicationTags || [],
      priorityWeight: dto.priorityWeight || 1,
    });

    const saved = await this.triageRuleRepository.save(rule);

    await this.audit.log({
      action: 'CREATE_TRIAGE_RULE',
      actorId: actor.id,
      actorRole: actor.role,
      targetEntityType: 'TriageRule',
      targetEntityId: saved.id,
      metadata: {
        symptomCode: saved.symptomCode,
        symptomName: saved.symptomName,
        isRedFlag: saved.isRedFlag,
        departmentCode: dept.code,
      },
    });

    return saved;
  }

  async updateTriageRule(id: string, dto: UpdateTriageRuleDto, actor: Actor) {
    const rule = await this.triageRuleRepository.findOne({
      where: { id },
      relations: { targetDepartment: true },
    });
    if (!rule) throw new NotFoundException(`Không tìm thấy quy tắc sàng lọc với ID ${id}`);

    if (dto.targetDepartmentId && dto.targetDepartmentId !== rule.targetDepartmentId) {
      const dept = await this.departmentRepository.findOne({
        where: { id: dto.targetDepartmentId },
      });
      if (!dept) {
        throw new NotFoundException(
          `Phòng khám chỉ định với ID ${dto.targetDepartmentId} không tồn tại.`,
        );
      }
      rule.targetDepartmentId = dto.targetDepartmentId;
    }

    if (dto.symptomName?.trim()) rule.symptomName = dto.symptomName.trim();
    if (dto.isRedFlag !== undefined) rule.isRedFlag = dto.isRedFlag;
    if (dto.contraindicationTags !== undefined)
      rule.contraindicationTags = dto.contraindicationTags;
    if (dto.priorityWeight !== undefined) rule.priorityWeight = dto.priorityWeight;

    const saved = await this.triageRuleRepository.save(rule);

    await this.audit.log({
      action: 'UPDATE_TRIAGE_RULE',
      actorId: actor.id,
      actorRole: actor.role,
      targetEntityType: 'TriageRule',
      targetEntityId: rule.id,
      metadata: { updates: dto },
    });

    return saved;
  }

  async deleteTriageRule(id: string, actor: Actor) {
    const rule = await this.triageRuleRepository.findOne({ where: { id } });
    if (!rule) throw new NotFoundException(`Không tìm thấy quy tắc sàng lọc với ID ${id}`);

    await this.triageRuleRepository.delete(id);

    await this.audit.log({
      action: 'DELETE_TRIAGE_RULE',
      actorId: actor.id,
      actorRole: actor.role,
      targetEntityType: 'TriageRule',
      targetEntityId: id,
      metadata: { symptomCode: rule.symptomCode },
    });

    return { message: 'Đã xóa quy tắc sàng lọc.', id };
  }

  // ---------------------------------------------------------
  // AUDIT LOGS (ACTIVITY TRAIL)
  // ---------------------------------------------------------

  async listAuditLogs(query: AdminAuditQueryDto) {
    const qb = this.auditLogRepository.createQueryBuilder('log');

    if (query.action?.trim()) {
      qb.andWhere('log.action = :action', { action: query.action.trim() });
    }

    if (query.actorRole?.trim()) {
      qb.andWhere('log.actorRole = :actorRole', { actorRole: query.actorRole.trim() });
    }

    if (query.search?.trim()) {
      const term = `%${query.search.trim()}%`;
      qb.andWhere('(log.targetEntityType ILIKE :term OR log.action ILIKE :term)', { term });
    }

    qb.orderBy('log.createdAt', 'DESC');

    const page = query.page || 1;
    const limit = query.limit || 20;
    qb.skip((page - 1) * limit).take(limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ---------------------------------------------------------
  // HOSPITAL ANALYTICS & REPORTS
  // ---------------------------------------------------------

  async getReportSummary(query: AdminReportsQueryDto) {
    const qb = this.visitRepository
      .createQueryBuilder('visit')
      .leftJoinAndSelect('visit.vital', 'vital');

    if (query.startDate) {
      qb.andWhere('visit.createdAt >= :startDate', { startDate: new Date(query.startDate) });
    }
    if (query.endDate) {
      const end = new Date(query.endDate);
      end.setHours(23, 59, 59, 999);
      qb.andWhere('visit.createdAt <= :endDate', { endDate: end });
    }
    if (query.departmentId) {
      qb.andWhere('(visit.initialDepartmentId = :deptId OR visit.currentDepartmentId = :deptId)', {
        deptId: query.departmentId,
      });
    }

    const visits = await qb.getMany();
    const totalVisits = visits.length;
    const byStatus: Record<string, number> = {};
    let statEmergencyCount = 0;
    const uniquePatients = new Set<string>();

    for (const v of visits) {
      byStatus[v.status] = (byStatus[v.status] || 0) + 1;
      if (v.patientId) uniquePatients.add(v.patientId);
      if (v.vital?.isRedFlag) statEmergencyCount++;
    }

    return {
      totalVisits,
      uniquePatients: uniquePatients.size,
      statEmergencyCount,
      emergencyRate:
        totalVisits > 0 ? Number(((statEmergencyCount / totalVisits) * 100).toFixed(1)) : 0,
      byStatus,
    };
  }

  async getDepartmentReports(query: AdminReportsQueryDto) {
    const departments = await this.departmentRepository.find({
      order: { floor: 'ASC', code: 'ASC' },
    });

    const qb = this.visitRepository.createQueryBuilder('visit');
    if (query.startDate) {
      qb.andWhere('visit.createdAt >= :startDate', { startDate: new Date(query.startDate) });
    }
    if (query.endDate) {
      const end = new Date(query.endDate);
      end.setHours(23, 59, 59, 999);
      qb.andWhere('visit.createdAt <= :endDate', { endDate: end });
    }

    const visits = await qb.getMany();
    const initialCounts: Record<string, number> = {};
    const currentCounts: Record<string, number> = {};
    const completedCounts: Record<string, number> = {};

    for (const v of visits) {
      if (v.initialDepartmentId) {
        initialCounts[v.initialDepartmentId] = (initialCounts[v.initialDepartmentId] || 0) + 1;
      }
      if (v.currentDepartmentId) {
        currentCounts[v.currentDepartmentId] = (currentCounts[v.currentDepartmentId] || 0) + 1;
        if (v.status === VisitStatus.COMPLETED) {
          completedCounts[v.currentDepartmentId] =
            (completedCounts[v.currentDepartmentId] || 0) + 1;
        }
      }
    }

    return departments.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      roomType: d.roomType,
      floor: d.floor,
      totalInitialVisits: initialCounts[d.id] || 0,
      totalCurrentVisits: currentCounts[d.id] || 0,
      completedVisits: completedCounts[d.id] || 0,
      avgServiceTimeMin: d.avgServiceTimeMin,
    }));
  }

  async getEtaPerformance(query: AdminReportsQueryDto) {
    const qb = this.etaForecastRepository.createQueryBuilder('forecast');
    if (query.startDate) {
      qb.andWhere('forecast.queuedAt >= :startDate', { startDate: new Date(query.startDate) });
    }
    if (query.endDate) {
      const end = new Date(query.endDate);
      end.setHours(23, 59, 59, 999);
      qb.andWhere('forecast.queuedAt <= :endDate', { endDate: end });
    }

    const forecasts = await qb.getMany();
    const evaluated = forecasts.filter((f) => f.actualStartedAt && f.estimatedStartAt);

    if (evaluated.length === 0) {
      return {
        totalForecasts: forecasts.length,
        evaluatedCount: 0,
        maeMinutes: 0,
        avgActualWaitMinutes: 0,
        avgEstimatedWaitMinutes: 0,
        within3MinCount: 0,
        within3MinRate: 0,
        within5MinCount: 0,
        within5MinRate: 0,
        distribution: {
          under3Min: 0,
          from3To5Min: 0,
          from5To10Min: 0,
          over10Min: 0,
        },
      };
    }

    let totalAbsErrorSec = 0;
    let totalActualWaitSec = 0;
    let totalEstimatedWaitSec = 0;
    let within3MinCount = 0;
    let within5MinCount = 0;
    let under3Min = 0;
    let from3To5Min = 0;
    let from5To10Min = 0;
    let over10Min = 0;

    for (const f of evaluated) {
      const actualStart = new Date(f.actualStartedAt!).getTime();
      const estStart = new Date(f.estimatedStartAt!).getTime();
      const queued = new Date(f.queuedAt).getTime();

      const absErrorSec = Math.abs(actualStart - estStart) / 1000;
      const absErrorMin = absErrorSec / 60;
      totalAbsErrorSec += absErrorSec;

      const actualWaitSec = Math.max(0, (actualStart - queued) / 1000);
      const estWaitSec = Math.max(0, (estStart - queued) / 1000);
      totalActualWaitSec += actualWaitSec;
      totalEstimatedWaitSec += estWaitSec;

      if (absErrorMin <= 3) {
        within3MinCount++;
        under3Min++;
      } else if (absErrorMin <= 5) {
        within5MinCount++;
        from3To5Min++;
      } else if (absErrorMin <= 10) {
        from5To10Min++;
      } else {
        over10Min++;
      }
    }

    within5MinCount += within3MinCount; // within 5 min includes within 3 min

    const n = evaluated.length;
    const maeMinutes = Number((totalAbsErrorSec / (n * 60)).toFixed(2));
    const avgActualWaitMinutes = Number((totalActualWaitSec / (n * 60)).toFixed(1));
    const avgEstimatedWaitMinutes = Number((totalEstimatedWaitSec / (n * 60)).toFixed(1));
    const within3MinRate = Number(((within3MinCount / n) * 100).toFixed(1));
    const within5MinRate = Number(((within5MinCount / n) * 100).toFixed(1));

    return {
      totalForecasts: forecasts.length,
      evaluatedCount: n,
      maeMinutes,
      avgActualWaitMinutes,
      avgEstimatedWaitMinutes,
      within3MinCount,
      within3MinRate,
      within5MinCount,
      within5MinRate,
      distribution: {
        under3Min,
        from3To5Min,
        from5To10Min,
        over10Min,
      },
    };
  }

  async getTriageRiskReport(query: AdminReportsQueryDto) {
    const qb = this.visitVitalRepository
      .createQueryBuilder('vital')
      .innerJoinAndSelect('vital.visit', 'visit');

    if (query.startDate) {
      qb.andWhere('vital.createdAt >= :startDate', { startDate: new Date(query.startDate) });
    }
    if (query.endDate) {
      const end = new Date(query.endDate);
      end.setHours(23, 59, 59, 999);
      qb.andWhere('vital.createdAt <= :endDate', { endDate: end });
    }

    const vitals = await qb.getMany();
    const total = vitals.length;

    let low = 0;
    let medium = 0;
    let high = 0;
    let redFlagCount = 0;
    const redFlagReasons: Record<string, number> = {};

    for (const v of vitals) {
      const risk = (v.news2Risk || 'LOW').toUpperCase();
      if (risk === 'HIGH') high++;
      else if (risk === 'MEDIUM') medium++;
      else low++;

      if (v.isRedFlag) {
        redFlagCount++;
        const reason = v.redFlagReason?.trim() || 'STAT Cấp cứu';
        redFlagReasons[reason] = (redFlagReasons[reason] || 0) + 1;
      }
    }

    return {
      totalVitals: total,
      riskTiers: {
        low: { count: low, percentage: total > 0 ? Number(((low / total) * 100).toFixed(1)) : 0 },
        medium: {
          count: medium,
          percentage: total > 0 ? Number(((medium / total) * 100).toFixed(1)) : 0,
        },
        high: {
          count: high,
          percentage: total > 0 ? Number(((high / total) * 100).toFixed(1)) : 0,
        },
      },
      redFlags: {
        count: redFlagCount,
        percentage: total > 0 ? Number(((redFlagCount / total) * 100).toFixed(1)) : 0,
        reasons: redFlagReasons,
      },
    };
  }

  async exportReportCsv(query: AdminReportsQueryDto): Promise<string> {
    const qb = this.visitRepository
      .createQueryBuilder('visit')
      .leftJoinAndSelect('visit.patient', 'patient')
      .leftJoinAndSelect('visit.initialDepartment', 'initialDepartment')
      .leftJoinAndSelect('visit.currentDepartment', 'currentDepartment')
      .leftJoinAndSelect('visit.vital', 'vital')
      .orderBy('visit.createdAt', 'DESC');

    if (query.startDate) {
      qb.andWhere('visit.createdAt >= :startDate', { startDate: new Date(query.startDate) });
    }
    if (query.endDate) {
      const end = new Date(query.endDate);
      end.setHours(23, 59, 59, 999);
      qb.andWhere('visit.createdAt <= :endDate', { endDate: end });
    }
    if (query.departmentId) {
      qb.andWhere('(visit.initialDepartmentId = :deptId OR visit.currentDepartmentId = :deptId)', {
        deptId: query.departmentId,
      });
    }

    const visits = await qb.getMany();

    const headers = [
      'Mã Lượt Khám',
      'Số Vé Sảnh',
      'Số Vé Khám',
      'Tên Bệnh Nhân',
      'Số Điện Thoại',
      'Khoa Tiếp Nhận Ban Đầu',
      'Khoa Khám Hiện Tại',
      'Trạng Thái',
      'Điểm NEWS2',
      'Phân Tầng Nguy Cơ',
      'Cờ Cấp Cứu STAT',
      'Lý Do Cấp Cứu',
      'Triệu Chứng Chính',
      'Thời Gian Tạo',
      'Thời Gian Tiếp Nhận Xong',
    ];

    const rows = visits.map((v) => [
      v.id,
      v.hallTicketNumber || '',
      v.clinicTicketNumber || '',
      v.patient?.name || '',
      v.patient?.phone || '',
      v.initialDepartment ? `${v.initialDepartment.code} - ${v.initialDepartment.name}` : '',
      v.currentDepartment ? `${v.currentDepartment.code} - ${v.currentDepartment.name}` : '',
      v.status,
      v.vital?.news2Score ?? '',
      v.vital?.news2Risk ?? '',
      v.vital?.isRedFlag ? 'CÓ (STAT)' : 'Không',
      v.vital?.redFlagReason || '',
      v.chiefComplaint || '',
      v.createdAt ? new Date(v.createdAt).toISOString() : '',
      v.intakeCompletedAt ? new Date(v.intakeCompletedAt).toISOString() : '',
    ]);

    const csvContent = [
      headers.map(escapeCsv).join(','),
      ...rows.map((row) => row.map(escapeCsv).join(',')),
    ].join('\r\n');

    // Return with UTF-8 BOM for Microsoft Excel compatibility
    return '\uFEFF' + csvContent;
  }
}
