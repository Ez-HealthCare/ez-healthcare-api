import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Role } from '../user/enums/role.enum';
import { RoomType } from '../department/enums/room-type.enum';
import { Department } from '../department/entities/department.entity';
import { DoctorSchedule } from '../department/entities/doctor-schedule.entity';
import { SystemConfig } from './entities/system-config.entity';
import { User } from '../database/entities/user.entity';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';

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
  ) {}

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

  async getConfigs() {
    return await this.configRepository.find();
  }
}
