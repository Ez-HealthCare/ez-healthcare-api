import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { Role } from './enums/role.enum';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
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
}
