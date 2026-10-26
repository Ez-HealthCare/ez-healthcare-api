import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { User } from '../database/entities/user.entity';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { Role } from './enums/role.enum';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly audit: AuditService,
  ) {}

  /**
   * Returns a list of users.
   * Sensitive PII columns (nationalId, insuranceCardNumber, allergies) are
   * only included when the caller has ADMIN or RECEPTIONIST role.
   */
  async findAll(callerRole: Role) {
    const isPiiRole = [Role.ADMIN, Role.RECEPTIONIST].includes(callerRole);

    const baseSelect = {
      id: true,
      email: true,
      name: true,
      role: true,
      phone: true,
      gender: true,
      dateOfBirth: true,
      isActive: true,
    };

    const piiSelect = isPiiRole
      ? { nationalId: true, insuranceCardNumber: true, allergies: true }
      : {};

    return this.userRepository.find({
      select: { ...baseSelect, ...piiSelect },
    });
  }

  async findById(id: string) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findByNationalId(nationalId: string) {
    const user = await this.userRepository.findOne({ where: { nationalId } });
    if (!user) {
      throw new NotFoundException(`User with National ID ${nationalId} not found`);
    }
    return user;
  }

  async getMyProfile(id: string) {
    return this.findById(id);
  }

  async updateMyProfile(id: string, dto: UpdateMyProfileDto) {
    const user = await this.findById(id);
    const nationalId = dto.nationalId.trim();
    const existing = await this.userRepository.findOne({ where: { nationalId } });
    if (existing && existing.id !== id) {
      throw new ConflictException('National ID is already registered to another patient.');
    }

    user.name = dto.name.trim();
    user.dateOfBirth = new Date(dto.dateOfBirth);
    user.gender = dto.gender.trim();
    user.phone = dto.phone.trim();
    user.nationalId = nationalId;
    user.allergies = dto.allergies.map((allergy) => allergy.trim()).filter(Boolean);
    user.insuranceCardNumber = dto.insuranceCardNumber?.trim() || undefined;
    const saved = await this.userRepository.save(user);
    await this.audit.log({
      action: 'UPDATE_PATIENT_PROFILE',
      actorId: id,
      actorRole: Role.PATIENT,
      targetEntityType: 'User',
      targetEntityId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return saved;
  }
}
