import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, QueryFailedError, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Role } from '../user/enums/role.enum';
import { RoomType } from '../department/enums/room-type.enum';
import { Department } from '../department/entities/department.entity';
import { DoctorSchedule } from '../department/entities/doctor-schedule.entity';
import { SystemConfig } from './entities/system-config.entity';
import { User } from '../database/entities/user.entity';
import { AuthSession } from '../auth/entities/auth-session.entity';
import { AuditService } from '../common/audit.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';
import { UpdateStaffUserDto } from './dto/update-staff-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

type Actor = { id: string; role: Role };

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
      const existingCccd = await this.userRepository.findOne({ where: { nationalId } });
      if (existingCccd) {
        throw new ConflictException(`Số CCCD ${nationalId} đã được sử dụng.`);
      }
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = this.userRepository.create({
      email,
      name: dto.name.trim(),
      role: dto.role,
      password: hashedPassword,
      phone: dto.phone?.trim() || undefined,
      nationalId: dto.nationalId?.trim() || undefined,
      gender: dto.gender?.trim() || undefined,
      isActive: true,
    });

    const saved = await this.userRepository.save(user);

    await this.audit.log({
      action: 'CREATE_STAFF_USER',
      actorId: actor.id,
      actorRole: actor.role,
      targetEntityType: 'User',
      targetEntityId: saved.id,
      metadata: { role: saved.role, email: saved.email, name: saved.name },
    });

    delete (saved as any).password;
    return saved;
  }

  async getUserById(id: string) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`Không tìm thấy người dùng với ID ${id}`);
    return user;
  }

  async updateStaffUser(id: string, dto: UpdateStaffUserDto, actor: Actor) {
    const user = await this.getUserById(id);

    if (dto.phone?.trim() && dto.phone.trim() !== user.phone) {
      const phone = dto.phone.trim();
      const collision = await this.userRepository.findOne({ where: { phone, id: Not(id) } });
      if (collision) {
        throw new ConflictException(`Số điện thoại ${phone} đã được sử dụng bởi tài khoản khác.`);
      }
      user.phone = phone;
    }

    if (dto.nationalId?.trim() && dto.nationalId.trim() !== user.nationalId) {
      const nationalId = dto.nationalId.trim();
      const collision = await this.userRepository.findOne({ where: { nationalId, id: Not(id) } });
      if (collision) {
        throw new ConflictException(`Số CCCD ${nationalId} đã được sử dụng bởi tài khoản khác.`);
      }
      user.nationalId = nationalId;
    }

    if (dto.name !== undefined) user.name = dto.name.trim();
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.gender !== undefined) user.gender = dto.gender.trim();

    if (dto.isActive !== undefined && dto.isActive !== user.isActive) {
      if (id === actor.id && !dto.isActive) {
        throw new BadRequestException('Không thể tự khóa tài khoản của chính mình.');
      }
      user.isActive = dto.isActive;
      if (!dto.isActive) {
        await this.sessionRepository.update(
          { userId: id, revokedAt: IsNull() },
          { revokedAt: new Date() },
        );
      }
    }

    const saved = await this.userRepository.save(user);

    await this.audit.log({
      action: 'UPDATE_STAFF_USER',
      actorId: actor.id,
      actorRole: actor.role,
      targetEntityType: 'User',
      targetEntityId: saved.id,
      metadata: { changes: dto },
    });

    return saved;
  }

  async toggleUserStatus(id: string, isActive: boolean, actor: Actor) {
    const user = await this.getUserById(id);

    if (id === actor.id && !isActive) {
      throw new BadRequestException('Không thể tự khóa tài khoản của chính mình.');
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
      action: isActive ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
      actorId: actor.id,
      actorRole: actor.role,
      targetEntityType: 'User',
      targetEntityId: user.id,
      metadata: { previousStatus: !isActive, newStatus: isActive },
    });

    return { id: user.id, isActive: user.isActive };
  }

  async resetPassword(id: string, dto: ResetPasswordDto, actor: Actor) {
    const user = await this.getUserById(id);

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    await this.userRepository.update(id, { password: hashedPassword });

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
      metadata: { targetEmail: user.email },
    });

    return { message: 'Đặt lại mật khẩu thành công.', userId: id };
  }

  // ---------------------------------------------------------
  // DEPARTMENT MANAGEMENT
  // ---------------------------------------------------------

  async listDepartments() {
    return await this.departmentRepository.find({
      order: { roomType: 'ASC', code: 'ASC' },
    });
  }

  async createDepartment(dto: CreateDepartmentDto) {
    const existing = await this.departmentRepository.findOne({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException(`Department with code ${dto.code} already exists.`);
    }

    const dept = this.departmentRepository.create({
      code: dto.code,
      name: dto.name,
      roomType: dto.roomType,
      floor: dto.floor || 1,
      avgServiceTimeMin: dto.avgServiceTimeMin || 15,
      maxQuotaPerSlot: dto.maxQuotaPerSlot || 40,
    });

    return await this.departmentRepository.save(dept);
  }

  async updateDepartment(id: string, dto: UpdateDepartmentDto, actor: Actor) {
    const dept = await this.departmentRepository.findOne({ where: { id } });
    if (!dept) throw new NotFoundException(`Không tìm thấy khoa/phòng với ID ${id}`);

    if (dto.name !== undefined) dept.name = dto.name.trim();
    if (dto.roomType !== undefined) dept.roomType = dto.roomType;
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
      targetEntityId: saved.id,
      metadata: { code: saved.code, changes: dto },
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
      qb.andWhere('department.code = :departmentCode', { departmentCode });
    }

    qb.orderBy('schedule.shiftDate', 'DESC').addOrderBy('schedule.shiftType', 'ASC');

    const schedules = await qb.getMany();
    return schedules.map((s) => ({
      id: s.id,
      doctorId: s.doctorId,
      doctorName: s.doctor.name,
      doctorEmail: s.doctor.email,
      departmentId: s.departmentId,
      departmentCode: s.department.code,
      departmentName: s.department.name,
      shiftDate: s.shiftDate,
      shiftType: s.shiftType,
      maxQuota: s.maxQuota,
      createdAt: s.createdAt,
    }));
  }

  async createSchedule(dto: CreateScheduleDto) {
    const doctor = await this.userRepository.findOne({ where: { id: dto.doctorId } });
    if (!doctor || doctor.role !== Role.DOCTOR || !doctor.isActive) {
      throw new NotFoundException(`Doctor with ID ${dto.doctorId} not found`);
    }

    const dept = await this.departmentRepository.findOne({ where: { code: dto.departmentCode } });
    if (!dept || !dept.isActive || dept.roomType !== RoomType.CONSULTATION) {
      throw new NotFoundException(`Department with code ${dto.departmentCode} not found`);
    }

    // Collision check
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

    const [totalDepartments, activeDepartments, totalSchedules] = await Promise.all([
      this.departmentRepository.count(),
      this.departmentRepository.count({ where: { isActive: true } }),
      this.scheduleRepository.count(),
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
    };
  }

  async getConfigs() {
    return await this.configRepository.find();
  }
}
