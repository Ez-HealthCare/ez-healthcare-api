import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { Role } from '../user/enums/role.enum';
import { PatientOtp } from './entities/patient-otp.entity';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginStaffDto } from './dto/login-staff.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(PatientOtp)
    private readonly otpRepository: Repository<PatientOtp>,
    private readonly jwtService: JwtService,
  ) {}

  async requestPatientOtp(dto: RequestOtpDto) {
    const { email } = dto;
    const existingOtp = await this.otpRepository.findOne({
      where: { email },
      order: { createdAt: 'DESC' },
    });

    if (existingOtp && existingOtp.lockedUntil && new Date(existingOtp.lockedUntil) > new Date()) {
      const remainingMin = Math.ceil(
        (new Date(existingOtp.lockedUntil).getTime() - Date.now()) / (60 * 1000),
      );
      throw new HttpException(
        `Too many failed attempts. Verification locked for ${remainingMin} more minute(s).`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Generate random 6-digit OTP or fixed for testing
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    const otp = this.otpRepository.create({
      email,
      otpCode,
      expiresAt,
      failedAttempts: 0,
      isUsed: false,
      lockedUntil: null,
    });
    await this.otpRepository.save(otp);

    console.log(`🔑 [DEV-OTP-DISPATCH] Email: ${email} | OTP: ${otpCode} (Valid for 5 mins)`);

    return {
      success: true,
      message: 'OTP has been dispatched successfully to email',
      otpCodePreview: process.env.NODE_ENV !== 'production' ? otpCode : undefined,
    };
  }

  async verifyPatientOtp(dto: VerifyOtpDto) {
    const { email, otpCode } = dto;
    const record = await this.otpRepository.findOne({
      where: { email },
      order: { createdAt: 'DESC' },
    });

    if (!record || record.isUsed) {
      throw new BadRequestException('No pending or valid OTP request found for this email');
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
      const attempts = record.failedAttempts + 1;
      if (attempts >= 3) {
        record.failedAttempts = attempts;
        record.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        await this.otpRepository.save(record);
        throw new HttpException(
          'Too many failed attempts. Verification locked for 15 minutes.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      } else {
        record.failedAttempts = attempts;
        await this.otpRepository.save(record);
        throw new BadRequestException(`Invalid OTP code. ${3 - attempts} attempt(s) remaining.`);
      }
    }

    // Mark as used
    record.isUsed = true;
    await this.otpRepository.save(record);

    // Find or create patient
    let user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      user = this.userRepository.create({
        email,
        name: email.split('@')[0],
        role: Role.PATIENT,
        isActive: true,
      });
      await this.userRepository.save(user);
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
    };
  }

  async loginStaff(dto: LoginStaffDto) {
    const { email, password } = dto;
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Staff account is deactivated');
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
    };
  }
}
