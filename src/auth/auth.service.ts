import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  Optional,
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
import { LoginDto } from './dto/login.dto';
import { RegisterPatientDto } from './dto/register-patient.dto';
import { VerifyRegisterDto } from './dto/verify-register.dto';
import { toMeResponse } from '../common/dto/response.dto';
import { BrevoMailService } from './brevo-mail.service';
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
  private readonly logger = new Logger(AuthService.name);
  private readonly brevoMail: BrevoMailService;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(PatientOtp) private readonly otps: Repository<PatientOtp>,
    private readonly jwt: JwtService,
    @InjectRepository(AuthSession) private readonly sessions: Repository<AuthSession>,
    private readonly config: ApiConfigService,
    @Optional() brevoMail?: BrevoMailService,
  ) {
    this.brevoMail = brevoMail || new BrevoMailService(this.config);
  }

  private async sendOtpMail(
    email: string,
    otpCode: string,
    subject = 'Ez-HealthCare - Ma dang nhap',
  ): Promise<{ sent: boolean; debugOtp?: string } | void> {
    const minutes = Math.round(OTP_LIFETIME_MS / 60_000);
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #00685f; margin: 0; font-size: 24px; font-weight: 700;">Ez-HealthCare</h2>
          <p style="color: #64748b; font-size: 13px; margin: 4px 0 0;">Cổng thông tin &amp; Hồ sơ bệnh án điện tử</p>
        </div>
        <p style="font-size: 15px; color: #1e293b;">Xin chào,</p>
        <p style="font-size: 15px; color: #1e293b; line-height: 1.5;">Bạn đang thực hiện thao tác xác thực trên hệ thống Ez-HealthCare. Mã xác thực (OTP) của bạn là:</p>
        <div style="text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #00685f; background: #e6f4f2; padding: 12px 28px; border-radius: 10px; display: inline-block;">
            ${otpCode}
          </span>
        </div>
        <p style="color: #64748b; font-size: 13px; line-height: 1.5;">
          Mã xác thực này có hiệu lực trong vòng <strong>${minutes} phút</strong>. Tuyệt đối không chia sẻ mã này với bất kỳ ai để bảo mật thông tin tài khoản của bạn.
        </p>
        <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0 16px;" />
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 0;">
          Đây là email tự động từ hệ thống Ez-HealthCare. Vui lòng không trả lời thư này.
        </p>
      </div>
    `;

    // 1. Ưu tiên gửi qua Brevo REST API (HTTPS port 443)
    if (this.config.brevo.enabled) {
      try {
        await this.brevoMail.sendMail({
          to: email,
          subject,
          htmlContent,
        });
        return { sent: true };
      } catch (err: unknown) {
        // Chế độ fallback demo khi OTP_DEBUG=true
        if (this.config.otpDebug) {
          this.logger.warn(
            `[CẢNH BÁO OTP_DEBUG] Gửi email qua Brevo thất bại (${(err as Error).message}), nhưng OTP_DEBUG=true đang bật. Kích hoạt fallback demo: OTP=${otpCode}`,
          );
          return { sent: false, debugOtp: otpCode };
        }

        // Nếu OTP_DEBUG=false hoặc không đặt: không bao giờ trả OTP trong response
        if (err instanceof HttpException) {
          throw err;
        }
        throw new ServiceUnavailableException(
          `Không thể gửi mã OTP qua Brevo. ${(err as Error).message || 'Vui lòng thử lại sau.'}`,
        );
      }
    }

    // 2. Dự phòng qua HTTP delivery URL (Resend / Mailpit cho unit tests / local dev)
    const delivery = this.config.otpDelivery;
    const deliveryUrl = delivery.url;
    if (deliveryUrl) {
      const isResend = deliveryUrl.includes('resend.com');
      const authHeader = delivery.authorization
        ? delivery.authorization.startsWith('Bearer ')
          ? delivery.authorization
          : `Bearer ${delivery.authorization}`
        : undefined;

      const body = isResend
        ? {
            from: `Ez-HealthCare <${delivery.from}>`,
            to: [email],
            subject,
            text:
              'Ma xac thuc cua ban: ' +
              otpCode +
              `. Ma co hieu luc trong ${OTP_LIFETIME_MS / 60_000} phut. Khong chia se ma nay.`,
          }
        : {
            From: {
              Email: delivery.from,
              Name: 'Ez-HealthCare',
            },
            To: [{ Email: email }],
            Subject: subject,
            Text:
              'Ma dang nhap cua ban: ' +
              otpCode +
              `. Ma co hieu luc trong ${OTP_LIFETIME_MS / 60_000} phut. Khong chia se ma nay.`,
          };

      try {
        const response = await fetch(deliveryUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { Authorization: authHeader } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(OTP_DELIVERY_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error('Email delivery failed');
        return { sent: true };
      } catch {
        if (this.config.otpDebug) {
          this.logger.warn(
            `[CẢNH BÁO OTP_DEBUG] Gửi email qua HTTP Delivery thất bại, nhưng OTP_DEBUG=true đang bật. Kích hoạt fallback demo: OTP=${otpCode}`,
          );
          return { sent: false, debugOtp: otpCode };
        }
        throw new ServiceUnavailableException('Unable to send OTP. Please try again later.');
      }
    }

    // 3. Nếu không cấu hình cả Brevo lẫn HTTP URL
    if (this.config.otpDebug) {
      this.logger.warn(
        `[CẢNH BÁO OTP_DEBUG] Chưa cấu hình dịch vụ email (BREVO_API_KEY/OTP_DELIVERY_URL), nhưng OTP_DEBUG=true đang bật. Kích hoạt fallback demo: OTP=${otpCode}`,
      );
      return { sent: false, debugOtp: otpCode };
    }

    this.logger.error(
      'Dịch vụ gửi email chưa được cấu hình (thiếu BREVO_API_KEY và OTP_DELIVERY_URL).',
    );
    throw new ServiceUnavailableException('Chưa cấu hình dịch vụ gửi email (BREVO_API_KEY).');
  }

  async requestPatientOtp(dto: RequestOtpDto) {
    const email = dto.email.trim().toLowerCase();
    let debugOtp: string | undefined;

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
      const sendResult = await this.sendOtpMail(email, otpCode);
      if (sendResult && 'debugOtp' in sendResult && sendResult.debugOtp) {
        debugOtp = sendResult.debugOtp;
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
      ...(debugOtp ? { debugOtp } : {}),
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

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();
    if (!user?.password || !user.isActive || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác.');
    }
    return this.createSession(user, dto.rememberMe === true);
  }

  async registerPatient(dto: RegisterPatientDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('Email này đã được đăng ký tài khoản.');
    }

    if (dto.phone?.trim()) {
      const existingPhone = await this.users.findOne({ where: { phone: dto.phone.trim() } });
      if (existingPhone) {
        throw new ConflictException('Số điện thoại đã được đăng ký trong hệ thống.');
      }
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    let debugOtp: string | undefined;

    await this.otps.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [email]);
      const userRepo = manager.getRepository(User);
      const existingInTx = await userRepo.findOne({ where: { email } });
      if (existingInTx) {
        throw new ConflictException('Email này đã được đăng ký tài khoản.');
      }

      const user = userRepo.create({
        email,
        password: hashedPassword,
        name: dto.name || email.split('@')[0],
        phone: dto.phone?.trim(),
        role: Role.PATIENT,
        isActive: false,
      });
      await userRepo.save(user);

      const otpRepo = manager.getRepository(PatientOtp);
      const previous = await otpRepo.findOne({ where: { email }, order: { createdAt: 'DESC' } });
      if (previous?.lockedUntil && previous.lockedUntil > new Date()) {
        throw new HttpException(OTP_LOCKED_MESSAGE, 429);
      }
      if (previous && Date.now() - previous.createdAt.getTime() < OTP_RESEND_DELAY_MS) {
        throw new HttpException(OTP_RESEND_MESSAGE, 429);
      }
      const otpCode = randomInt(OTP_MIN_VALUE, OTP_MAX_EXCLUSIVE).toString();
      const sendResult = await this.sendOtpMail(
        email,
        otpCode,
        'Ez-HealthCare - Ma xac thuc dang ky',
      );
      if (sendResult && 'debugOtp' in sendResult && sendResult.debugOtp) {
        debugOtp = sendResult.debugOtp;
      }

      await otpRepo.save(
        otpRepo.create({
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
      message: 'Mã OTP xác thực đã được gửi đến email của bạn.',
      retryAfterSeconds: OTP_RESEND_SECONDS,
      ...(debugOtp ? { debugOtp } : {}),
    };
  }

  async verifyPatientRegistration(dto: VerifyRegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const outcome = await this.otps.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [email]);
      const repo = manager.getRepository(PatientOtp);
      const record = await repo.findOne({ where: { email }, order: { createdAt: 'DESC' } });
      if (!record || record.isUsed)
        return new BadRequestException('Không tìm thấy yêu cầu xác thực OTP.');
      if (record.lockedUntil && record.lockedUntil > new Date()) {
        return new HttpException(OTP_LOCKED_MESSAGE, 429);
      }
      if (record.expiresAt <= new Date()) return new BadRequestException('Mã OTP đã hết hạn.');

      if (record.otpCode !== hash(dto.otpCode)) {
        record.failedAttempts += 1;
        if (record.failedAttempts >= OTP_MAX_ATTEMPTS) {
          record.lockedUntil = new Date(Date.now() + OTP_LOCKOUT_MS);
        }
        await repo.save(record);
        return record.failedAttempts >= OTP_MAX_ATTEMPTS
          ? new HttpException(OTP_LOCKED_MESSAGE, 429)
          : new BadRequestException('Mã OTP không chính xác.');
      }

      const userRepo = manager.getRepository(User);
      const user = await userRepo.findOne({ where: { email } });
      if (!user) {
        return new BadRequestException('Không tìm thấy hồ sơ đăng ký.');
      }
      user.isActive = true;
      await userRepo.save(user);

      record.isUsed = true;
      await repo.save(record);
      return user;
    });

    if (outcome instanceof HttpException) throw outcome;
    if (outcome instanceof Error) throw outcome;
    return this.createSession(outcome, dto.rememberMe === true);
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
