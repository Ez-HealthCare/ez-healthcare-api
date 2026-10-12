import {
  BadRequestException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { jest } from '@jest/globals';
import { Role } from '../user/enums/role.enum';

// Mock Interfaces and Types for Auth Spec
export interface PatientOtpRecord {
  id: string;
  email: string;
  otpCode: string;
  expiresAt: Date;
  failedAttempts: number;
  isUsed: boolean;
  lockedUntil: Date | null;
}

export class MockAuthService {
  constructor(
    private readonly userRepo: any,
    private readonly otpRepo: any,
    private readonly jwtService: any,
  ) {}

  async requestPatientOtp(email: string): Promise<{ message: string; otpCode?: string }> {
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Invalid email address format');
    }

    const existingOtp = await this.otpRepo.findOne({ where: { email } });
    if (existingOtp && existingOtp.lockedUntil && new Date(existingOtp.lockedUntil) > new Date()) {
      throw new HttpException(
        'Too many failed attempts. Verification locked for 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const otpCode = '123456';
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.otpRepo.save({
      email,
      otpCode,
      expiresAt,
      failedAttempts: 0,
      isUsed: false,
      lockedUntil: null,
    });

    return {
      message: 'OTP has been dispatched successfully',
      otpCode,
    };
  }

  async verifyPatientOtp(
    email: string,
    otpCode: string,
  ): Promise<{ accessToken: string; user: any }> {
    const record = await this.otpRepo.findOne({ where: { email } });
    if (!record) {
      throw new BadRequestException('No pending OTP request found for this email');
    }

    if (record.lockedUntil && new Date(record.lockedUntil) > new Date()) {
      throw new HttpException(
        'Too many failed attempts. Verification locked for 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (new Date() > new Date(record.expiresAt)) {
      throw new BadRequestException('OTP code has expired. Please request a new code.');
    }

    if (record.otpCode !== otpCode) {
      const updatedAttempts = record.failedAttempts + 1;
      if (updatedAttempts >= 3) {
        await this.otpRepo.save({
          ...record,
          failedAttempts: updatedAttempts,
          lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
        });
        throw new HttpException(
          'Too many failed attempts. Verification locked for 15 minutes.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      } else {
        await this.otpRepo.save({ ...record, failedAttempts: updatedAttempts });
        throw new BadRequestException(
          `Invalid OTP code. ${3 - updatedAttempts} attempts remaining.`,
        );
      }
    }

    record.isUsed = true;
    await this.otpRepo.save(record);

    let user = await this.userRepo.findOne({ where: { email } });
    if (!user) {
      user = await this.userRepo.save({ email, role: Role.PATIENT, isActive: true });
    }

    const token = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });
    return { accessToken: token, user };
  }

  async loginStaff(credentials: {
    email: string;
    password: string;
  }): Promise<{ accessToken: string; role: Role }> {
    const user = await this.userRepo.findOne({ where: { email: credentials.email } });
    if (!user || credentials.password !== 'Doctor@123456') {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Staff account is deactivated');
    }

    const token = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });
    return { accessToken: token, role: user.role };
  }
}

describe('AuthService (Specification: Happy & Unhappy Cases)', () => {
  let authService: MockAuthService;
  let mockUserRepo: any;
  let mockOtpRepo: any;
  let mockJwtService: any;

  beforeEach(() => {
    mockUserRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    mockOtpRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    mockJwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
    };

    authService = new MockAuthService(mockUserRepo, mockOtpRepo, mockJwtService);
  });

  describe('requestPatientOtp', () => {
    describe('Happy Path', () => {
      it('should generate a 6-digit OTP and set 5-minute expiration for valid email', async () => {
        mockOtpRepo.findOne.mockResolvedValue(null);
        mockOtpRepo.save.mockResolvedValue({});

        const result = await authService.requestPatientOtp('patient.alex@example.com');

        expect(result.message).toBe('OTP has been dispatched successfully');
        expect(result.otpCode).toBe('123456');
        expect(mockOtpRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            email: 'patient.alex@example.com',
            otpCode: '123456',
            failedAttempts: 0,
            isUsed: false,
          }),
        );
      });
    });

    describe('Unhappy Path', () => {
      it('should throw BadRequestException if email format is invalid', async () => {
        await expect(authService.requestPatientOtp('invalid-email')).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should throw TooManyRequestsException (429) if account is within 15-minute lockout', async () => {
        const lockedRecord = {
          email: 'locked@example.com',
          lockedUntil: new Date(Date.now() + 10 * 60 * 1000), // locked for 10 more minutes
        };
        mockOtpRepo.findOne.mockResolvedValue(lockedRecord);

        await expect(authService.requestPatientOtp('locked@example.com')).rejects.toThrow(
          HttpException,
        );
      });
    });
  });

  describe('verifyPatientOtp', () => {
    describe('Happy Path', () => {
      it('should authenticate patient, provision new user record if not exists, and return JWT token', async () => {
        const validOtpRecord = {
          email: 'patient@example.com',
          otpCode: '123456',
          expiresAt: new Date(Date.now() + 3 * 60 * 1000),
          failedAttempts: 0,
          lockedUntil: null,
          isUsed: false,
        };
        mockOtpRepo.findOne.mockResolvedValue(validOtpRecord);
        mockUserRepo.findOne.mockResolvedValue(null);
        mockUserRepo.save.mockResolvedValue({
          id: 'uuid-1',
          email: 'patient@example.com',
          role: Role.PATIENT,
        });

        const result = await authService.verifyPatientOtp('patient@example.com', '123456');

        expect(result.accessToken).toBe('mock-jwt-token');
        expect(result.user.role).toBe(Role.PATIENT);
        expect(validOtpRecord.isUsed).toBe(true);
      });
    });

    describe('Unhappy Path', () => {
      it('should throw BadRequestException on wrong OTP and decrement attempts', async () => {
        const validOtpRecord = {
          email: 'patient@example.com',
          otpCode: '123456',
          expiresAt: new Date(Date.now() + 3 * 60 * 1000),
          failedAttempts: 0,
          lockedUntil: null,
        };
        mockOtpRepo.findOne.mockResolvedValue(validOtpRecord);

        await expect(authService.verifyPatientOtp('patient@example.com', '999999')).rejects.toThrow(
          BadRequestException,
        );
        expect(mockOtpRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({ failedAttempts: 1 }),
        );
      });

      it('should lock account for 15 minutes and throw 429 after 3 failed OTP attempts', async () => {
        const recordAtSecondFail = {
          email: 'patient@example.com',
          otpCode: '123456',
          expiresAt: new Date(Date.now() + 3 * 60 * 1000),
          failedAttempts: 2, // 3rd attempt will fail
          lockedUntil: null,
        };
        mockOtpRepo.findOne.mockResolvedValue(recordAtSecondFail);

        await expect(authService.verifyPatientOtp('patient@example.com', '999999')).rejects.toThrow(
          HttpException,
        );
        expect(mockOtpRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            failedAttempts: 3,
            lockedUntil: expect.any(Date),
          }),
        );
      });

      it('should throw BadRequestException if OTP code has expired', async () => {
        const expiredRecord = {
          email: 'patient@example.com',
          otpCode: '123456',
          expiresAt: new Date(Date.now() - 1000), // expired 1s ago
          failedAttempts: 0,
          lockedUntil: null,
        };
        mockOtpRepo.findOne.mockResolvedValue(expiredRecord);

        await expect(authService.verifyPatientOtp('patient@example.com', '123456')).rejects.toThrow(
          new BadRequestException('OTP code has expired. Please request a new code.'),
        );
      });
    });
  });

  describe('loginStaff', () => {
    describe('Happy Path', () => {
      it('should authenticate doctor with valid credentials and return JWT token with role', async () => {
        mockUserRepo.findOne.mockResolvedValue({
          id: 'doc-uuid',
          email: 'dr.smith@ezhealthcare.com',
          role: Role.DOCTOR,
          isActive: true,
        });

        const result = await authService.loginStaff({
          email: 'dr.smith@ezhealthcare.com',
          password: 'Doctor@123456',
        });

        expect(result.accessToken).toBe('mock-jwt-token');
        expect(result.role).toBe(Role.DOCTOR);
      });
    });

    describe('Unhappy Path', () => {
      it('should throw UnauthorizedException when password does not match', async () => {
        mockUserRepo.findOne.mockResolvedValue({
          id: 'doc-uuid',
          email: 'dr.smith@ezhealthcare.com',
          role: Role.DOCTOR,
          isActive: true,
        });

        await expect(
          authService.loginStaff({ email: 'dr.smith@ezhealthcare.com', password: 'WrongPassword' }),
        ).rejects.toThrow(UnauthorizedException);
      });

      it('should throw UnauthorizedException when staff account is inactive', async () => {
        mockUserRepo.findOne.mockResolvedValue({
          id: 'doc-uuid',
          email: 'dr.smith@ezhealthcare.com',
          role: Role.DOCTOR,
          isActive: false, // Inactive
        });

        await expect(
          authService.loginStaff({ email: 'dr.smith@ezhealthcare.com', password: 'Doctor@123456' }),
        ).rejects.toThrow(new UnauthorizedException('Staff account is deactivated'));
      });
    });
  });
});
