import {
  BadRequestException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiConfigService } from '../config/api-config.service';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { Role } from '../user/enums/role.enum';
import { PatientOtp } from './entities/patient-otp.entity';
import { AuthSession } from './entities/auth-session.entity';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginStaffDto } from './dto/login-staff.dto';
import { toMeResponse } from '../common/dto/response.dto';
import {
  ACCESS_SECONDS,
  OTP_MIN_VALUE,
  OTP_MAX_EXCLUSIVE,
  OTP_RESEND_DELAY_MS,
  OTP_RESEND_SECONDS,
  OTP_LIFETIME_MS,
  OTP_MAX_ATTEMPTS,
  OTP_LOCKOUT_MS,
  OTP_DELIVERY_TIMEOUT_MS,
  REFRESH_TOKEN_BYTES,
  REFRESH_TOKEN_PATTERN,
  SESSION_LIFETIME_MS,
  REMEMBERED_SESSION_LIFETIME_MS,
  OTP_LOCKED_MESSAGE,
  OTP_RESEND_MESSAGE,
} from '../common/constants/auth.constants';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(PatientOtp) private readonly otps: Repository<PatientOtp>,
    private readonly jwt: JwtService,
    @InjectRepository(AuthSession) private readonly sessions: Repository<AuthSession>,
    private readonly config: ApiConfigService,
  ) {}

  async requestPatientOtp(dto: RequestOtpDto) {
    const email = dto.email.trim().toLowerCase();
    await this.otps.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [email]);
      const repo = manager.getRepository(PatientOtp);
      const previous = await repo.findOne({ where: { email }, order: { createdAt: 'DESC' } });
      if (previous?.lockedUntil && previous.lockedUntil > new Date()) {
        throw new HttpException(OTP_LOCKED_MESSAGE, 429);
      }
      if (previous && Date.now() - previous.createdAt.getTime() < OTP_RESEND_DELAY_MS) {
        throw new HttpException(OTP_RESEND_MESSAGE, 429);
      }
      const otpCode = randomInt(OTP_MIN_VALUE, OTP_MAX_EXCLUSIVE).toString();
      const delivery = this.config.otpDelivery;
      const deliveryUrl = delivery.url;
      if (!deliveryUrl) {
        throw new ServiceUnavailableException('Email delivery is not configured.');
      }
      try {
        const response = await fetch(deliveryUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(delivery.authorization ? { Authorization: delivery.authorization } : {}),
          },
          body: JSON.stringify({
            From: {
              Email: delivery.from,
              Name: 'Ez-HealthCare',
            },
            To: [{ Email: email }],
            Subject: 'Ez-HealthCare - Ma dang nhap',
            Text:
              'Ma dang nhap cua ban: ' +
              otpCode +
              `. Ma co hieu luc trong ${OTP_LIFETIME_MS / 60_000} phut. Khong chia se ma nay.`,
          }),
          signal: AbortSignal.timeout(OTP_DELIVERY_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error('Email delivery failed');
      } catch {
        throw new ServiceUnavailableException('Unable to send OTP. Please try again later.');
      }
      await repo.save(
        repo.create({
          email,
          otpCode: hash(otpCode),
          expiresAt: new Date(Date.now() + OTP_LIFETIME_MS),
          failedAttempts: 0,
          isUsed: false,
          lockedUntil: null,
        }),
      );
    });
    return {
      success: true,
      message: 'OTP sent to your email.',
      retryAfterSeconds: OTP_RESEND_SECONDS,
    };
  }

  async verifyPatientOtp(dto: VerifyOtpDto) {
    const email = dto.email.trim().toLowerCase();
    const outcome = await this.otps.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [email]);
      const repo = manager.getRepository(PatientOtp);
      const record = await repo.findOne({ where: { email }, order: { createdAt: 'DESC' } });
      if (!record || record.isUsed) return new BadRequestException('No pending OTP request.');
      if (record.lockedUntil && record.lockedUntil > new Date()) {
        return new HttpException(OTP_LOCKED_MESSAGE, 429);
      }
      if (record.expiresAt <= new Date()) return new BadRequestException('OTP has expired.');
      if (!timingSafeEqual(Buffer.from(record.otpCode), Buffer.from(hash(dto.otpCode)))) {
        record.failedAttempts += 1;
        if (record.failedAttempts >= OTP_MAX_ATTEMPTS)
          record.lockedUntil = new Date(Date.now() + OTP_LOCKOUT_MS);
        await repo.save(record);
        return record.failedAttempts >= OTP_MAX_ATTEMPTS
          ? new HttpException(OTP_LOCKED_MESSAGE, 429)
          : new BadRequestException('Invalid OTP code.');
      }
      const userRepo = manager.getRepository(User);
      let user = await userRepo.findOne({ where: { email } });
      if (user && (!user.isActive || user.role !== Role.PATIENT)) {
        return new UnauthorizedException('This email cannot use patient login.');
      }
      if (!user) {
        user = await userRepo.save(
          userRepo.create({
            email,
            name: email.split('@')[0],
            role: Role.PATIENT,
            isActive: true,
          }),
        );
      }
      record.isUsed = true;
      await repo.save(record);
      return user;
    });
    // Return errors from the transaction so failed-attempt counters are committed.
    if (outcome instanceof HttpException) throw outcome;
    return this.createSession(outcome, dto.rememberMe === true);
  }

  async loginStaff(dto: LoginStaffDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();
    if (
      !user?.password ||
      user.role === Role.PATIENT ||
      !user.isActive ||
      !(await bcrypt.compare(dto.password, user.password))
    ) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    return this.createSession(user, dto.rememberMe === true);
  }

  private async createSession(user: User, rememberMe: boolean) {
    const id = randomUUID();
    const refreshToken = id + '.' + randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const session = await this.sessions.save(
      this.sessions.create({
        id,
        userId: user.id,
        tokenHash: hash(refreshToken),
        rememberMe,
        expiresAt: new Date(
          Date.now() + (rememberMe ? REMEMBERED_SESSION_LIFETIME_MS : SESSION_LIFETIME_MS),
        ),
        revokedAt: null,
      }),
    );
    return this.sessionResponse(user, session, refreshToken);
  }

  private sessionResponse(user: User, session: AuthSession, refreshToken: string) {
    return {
      accessToken: this.jwt.sign({
        sub: user.id,
        sid: session.id,
        email: user.email,
        role: user.role,
      }),
      expiresIn: ACCESS_SECONDS,
      refreshToken,
      expiresAt: session.expiresAt,
      rememberMe: session.rememberMe,
    };
  }

  private async findRefreshSession(token?: string) {
    if (!token || !REFRESH_TOKEN_PATTERN.test(token)) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    const session = await this.sessions.findOne({ where: { id: token.split('.')[0] } });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !timingSafeEqual(Buffer.from(session.tokenHash), Buffer.from(hash(token)))
    ) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    return session;
  }

  async refresh(token?: string) {
    const session = await this.findRefreshSession(token);
    const user = await this.users.findOne({ where: { id: session.userId, isActive: true } });
    if (!user) throw new UnauthorizedException('Account is inactive.');
    const nextToken = session.id + '.' + randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const changed = await this.sessions.update(
      { id: session.id, tokenHash: session.tokenHash, revokedAt: IsNull() },
      { tokenHash: hash(nextToken) },
    );
    if (changed.affected !== 1) throw new UnauthorizedException('Refresh token already used.');
    return this.sessionResponse(user, session, nextToken);
  }

  async logout(token?: string) {
    try {
      const session = await this.findRefreshSession(token);
      await this.sessions.update({ id: session.id }, { revokedAt: new Date() });
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
    }
    return { success: true };
  }

  async getMe(id: string) {
    const user = await this.users.findOne({ where: { id, isActive: true } });
    if (!user) throw new UnauthorizedException('Account is inactive.');
    return toMeResponse(user);
  }
}
