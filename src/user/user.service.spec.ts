import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { Role } from './enums/role.enum';

export interface CreateUserDto {
  email: string;
  name: string;
  role: Role;
  nationalId?: string;
  insuranceCardNumber?: string;
  allergies?: string[];
}

export class MockUserService {
  constructor(private readonly userRepo: any) {}

  async createUser(dto: CreateUserDto) {
    if (!dto.email || !dto.email.includes('@')) {
      throw new BadRequestException('Invalid email format');
    }

    const existing = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException(`User with email ${dto.email} already exists`);
    }

    const user = {
      id: 'user-uuid-1',
      ...dto,
      isActive: true,
      createdAt: new Date(),
    };

    return await this.userRepo.save(user);
  }

  async findById(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findByNationalId(nationalId: string) {
    const user = await this.userRepo.findOne({ where: { nationalId } });
    if (!user) {
      throw new NotFoundException(`User with National ID ${nationalId} not found`);
    }
    return user;
  }

  async updateAllergies(id: string, allergies: string[]) {
    const user = await this.findById(id);
    user.allergies = allergies;
    return await this.userRepo.save(user);
  }
}

describe('UserService (Specification: User Management Happy & Unhappy Cases)', () => {
  let service: MockUserService;
  let mockUserRepo: any;

  beforeEach(() => {
    mockUserRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((u) => Promise.resolve(u)),
    };
    service = new MockUserService(mockUserRepo);
  });

  describe('createUser', () => {
    describe('Happy Path', () => {
      it('should successfully create a new patient with valid details and allergies', async () => {
        mockUserRepo.findOne.mockResolvedValue(null);

        const dto: CreateUserDto = {
          email: 'john.patient@example.com',
          name: 'John Doe',
          role: Role.PATIENT,
          nationalId: '079123456789',
          insuranceCardNumber: 'DN4791234567890',
          allergies: ['Penicillin', 'Aspirin'],
        };

        const result = await service.createUser(dto);

        expect(result.id).toBe('user-uuid-1');
        expect(result.email).toBe(dto.email);
        expect(result.role).toBe(Role.PATIENT);
        expect(result.allergies).toEqual(['Penicillin', 'Aspirin']);
        expect(result.isActive).toBe(true);
      });
    });

    describe('Unhappy Path', () => {
      it('should throw BadRequestException if email format is invalid', async () => {
        const dto: CreateUserDto = {
          email: 'invalid-email',
          name: 'Invalid User',
          role: Role.PATIENT,
        };

        await expect(service.createUser(dto)).rejects.toThrow(
          new BadRequestException('Invalid email format'),
        );
      });

      it('should throw ConflictException if user with the same email already exists', async () => {
        mockUserRepo.findOne.mockResolvedValue({
          id: 'existing-id',
          email: 'existing@example.com',
        });

        const dto: CreateUserDto = {
          email: 'existing@example.com',
          name: 'Duplicate User',
          role: Role.PATIENT,
        };

        await expect(service.createUser(dto)).rejects.toThrow(ConflictException);
      });
    });
  });

  describe('findById & findByNationalId', () => {
    describe('Happy Path', () => {
      it('should find user by ID when user exists', async () => {
        const mockUser = { id: 'u-123', name: 'Dr. House', role: Role.DOCTOR };
        mockUserRepo.findOne.mockResolvedValue(mockUser);

        const result = await service.findById('u-123');
        expect(result.name).toBe('Dr. House');
      });

      it('should find user by National ID during reception audit', async () => {
        const mockUser = { id: 'u-456', nationalId: '079999888777', name: 'Alice' };
        mockUserRepo.findOne.mockResolvedValue(mockUser);

        const result = await service.findByNationalId('079999888777');
        expect(result.name).toBe('Alice');
      });
    });

    describe('Unhappy Path', () => {
      it('should throw NotFoundException when ID does not exist', async () => {
        mockUserRepo.findOne.mockResolvedValue(null);

        await expect(service.findById('non-existent')).rejects.toThrow(NotFoundException);
      });

      it('should throw NotFoundException when National ID does not exist', async () => {
        mockUserRepo.findOne.mockResolvedValue(null);

        await expect(service.findByNationalId('000000000000')).rejects.toThrow(NotFoundException);
      });
    });
  });

  describe('updateAllergies', () => {
    it('should update allergy list for medical safety checks', async () => {
      const mockUser = { id: 'u-1', name: 'Bob', allergies: [] };
      mockUserRepo.findOne.mockResolvedValue(mockUser);

      const result = await service.updateAllergies('u-1', ['Aspirin', 'Ibuprofen']);
      expect(result.allergies).toEqual(['Aspirin', 'Ibuprofen']);
    });
  });
});
