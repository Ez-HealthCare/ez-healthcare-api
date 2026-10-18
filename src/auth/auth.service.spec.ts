import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { jest } from '@jest/globals';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { AuthService } from './auth.service';
import { Role } from '../user/enums/role.enum';
import { User } from '../database/entities/user.entity';
import { setSessionCookies } from './auth.config';
import { ConfigService } from '@nestjs/config';
import { ApiConfigService } from '../config/api-config.service';
import type { Response } from 'express';

describe('AuthService (production implementation)', () => {
  let service: AuthService;
  let user: any;
  let otp: any;
  let session: any;
  let users: any;
  let otps: any;
  let sessions: any;
  let delivery: ReturnType<typeof jest.spyOn>;
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');

  beforeEach(async () => {
    user = {
      id: '163e251b-adc5-4139-a464-f290ac8fbaef',
      email: 'staff@example.com',
      role: Role.NURSE,
      isActive: true,
      password: await bcrypt.hash('Correct@123', 4),
    };
    otp = undefined;
    session = undefined;
    users = {
      findOne: jest
        .fn<any>()
        .mockImplementation(async ({ where }: any) =>
          user && (!where.isActive || user.isActive) ? user : null,
        ),
      create: (value: any) => value,
      save: jest.fn<any>().mockImplementation(async (value: any) => {
        user = { id: '163e251b-adc5-4139-a464-f290ac8fbaef', ...value };
        return user;
      }),
      createQueryBuilder: () => ({
        addSelect: () => ({
          where: () => ({ getOne: async () => user }),
        }),
      }),
    };
    sessions = {
      create: (value: any) => value,
      save: jest.fn<any>().mockImplementation(async (value: any) => {
        session = value;
        return value;
      }),
      findOne: jest.fn<any>().mockImplementation(async () => (session ? { ...session } : null)),
      update: jest.fn<any>().mockImplementation(async (where: any, change: any) => {
        if (
          !session ||
          where.id !== session.id ||
          (where.tokenHash && where.tokenHash !== session.tokenHash)
        )
          return { affected: 0 };
        Object.assign(session, change);
        return { affected: 1 };
      }),
    };
    otps = {
      create: (value: any) => value,
      findOne: jest.fn<any>().mockImplementation(async () => otp),
      save: jest.fn<any>().mockImplementation(async (value: any) => {
        otp = { id: 'otp-1', createdAt: new Date(), ...value };
        return otp;
      }),
      manager: {
        transaction: async (fn: any) =>
          fn({
            query: async () => undefined,
            getRepository: (entity: unknown) => (entity === User ? users : otps),
          }),
      },
    };
    delivery = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    service = new AuthService(
      users,
      otps,
      new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '15m' } }),
      sessions,
      new ApiConfigService(
        new ConfigService({
          OTP_DELIVERY_URL: 'http://mailpit/api/v1/send',
          OTP_FROM: 'configured@example.com',
          OTP_DELIVERY_AUTH: 'Bearer fixture-only',
        }),
      ),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(Object.values(Role).filter((role) => role !== Role.PATIENT))(
    'authenticates staff role %s with bcrypt and includes a live session id',
    async (role) => {
      user.role = role;
      const result = await service.loginStaff({
        email: ' STAFF@example.com ',
        password: 'Correct@123',
      });
      const payload = new JwtService({ secret: 'test-secret' }).verify(result.accessToken);
      expect(payload.role).toBe(role);
      expect(payload.sid).toBe(session.id);
      expect(session.tokenHash).not.toBe(result.refreshToken);
      expect(session.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(8 * 60 * 60_000);
    },
  );

  it('rejects incorrect passwords, inactive accounts and patient password login', async () => {
    await expect(
      service.loginStaff({ email: user.email, password: 'Wrong@123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    user.isActive = false;
    await expect(
      service.loginStaff({ email: user.email, password: 'Correct@123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    user.isActive = true;
    user.role = Role.PATIENT;
    await expect(
      service.loginStaff({ email: user.email, password: 'Correct@123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rotates refresh tokens once and revokes the session on logout', async () => {
    const login = await service.loginStaff({
      email: user.email,
      password: 'Correct@123',
      rememberMe: true,
    });
    expect(session.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60_000);
    const refreshed = await service.refresh(login.refreshToken);
    expect(refreshed.refreshToken).not.toBe(login.refreshToken);
    await expect(service.refresh(login.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await service.logout(refreshed.refreshToken);
    expect(session.revokedAt).toBeInstanceOf(Date);
    await expect(service.refresh(refreshed.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects expired sessions and inactive users during refresh', async () => {
    const login = await service.loginStaff({ email: user.email, password: 'Correct@123' });
    session.expiresAt = new Date(0);
    await expect(service.refresh(login.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    session.expiresAt = new Date(Date.now() + 10000);
    user.isActive = false;
    await expect(service.refresh(login.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('sends a random OTP by email, stores only its hash and never returns the code', async () => {
    const response = await service.requestPatientOtp({ email: 'patient@example.com' });
    const sent = JSON.parse(String((delivery.mock.calls[0] as any)[1].body));
    const code = sent.Text.match(/\d{6}/)[0];
    expect(delivery.mock.calls[0]?.[0]).toBe('http://mailpit/api/v1/send');
    expect(sent.From.Email).toBe('configured@example.com');
    expect((delivery.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer fixture-only');
    expect(otp.otpCode).toBe(digest(code));
    expect(JSON.stringify(response)).not.toContain(code);
    await expect(
      service.requestPatientOtp({ email: 'patient@example.com' }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('fails closed when mail delivery is unavailable', async () => {
    delivery.mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(service.requestPatientOtp({ email: 'patient@example.com' })).rejects.toThrow(
      'Unable to send OTP',
    );
    expect(otps.save).not.toHaveBeenCalled();
  });

  function pendingOtp() {
    otp = {
      id: 'otp-1',
      email: 'patient@example.com',
      otpCode: digest('123456'),
      expiresAt: new Date(Date.now() + 60_000),
      failedAttempts: 0,
      isUsed: false,
      lockedUntil: null,
    };
  }

  it('creates a patient through OTP and prevents OTP reuse', async () => {
    pendingOtp();
    user = undefined;
    const result = await service.verifyPatientOtp({
      email: 'patient@example.com',
      otpCode: '123456',
    });
    expect(new JwtService({ secret: 'test-secret' }).verify(result.accessToken).role).toBe(
      Role.PATIENT,
    );
    expect(otp.isUsed).toBe(true);
    await expect(
      service.verifyPatientOtp({ email: 'patient@example.com', otpCode: '123456' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists failure counts and locks the OTP after three errors', async () => {
    pendingOtp();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await expect(
        service.verifyPatientOtp({ email: 'patient@example.com', otpCode: '999999' }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(otp.failedAttempts).toBe(attempt);
    }
    expect(otp.lockedUntil).toBeInstanceOf(Date);
    await expect(
      service.verifyPatientOtp({ email: 'patient@example.com', otpCode: '123456' }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('rejects expired OTPs, deactivated patients and staff accounts using patient OTP', async () => {
    pendingOtp();
    otp.expiresAt = new Date(0);
    await expect(
      service.verifyPatientOtp({ email: 'patient@example.com', otpCode: '123456' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    otp.expiresAt = new Date(Date.now() + 60_000);
    await expect(
      service.verifyPatientOtp({ email: 'patient@example.com', otpCode: '123456' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    user.role = Role.PATIENT;
    user.isActive = false;
    await expect(
      service.verifyPatientOtp({ email: 'patient@example.com', otpCode: '123456' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('sets secure HttpOnly cookies in production and honors remember-me', () => {
    const config = new ApiConfigService(new ConfigService({ NODE_ENV: 'production' }));
    const cookie = jest.fn();
    const result = {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: new Date(),
      rememberMe: false,
    };
    setSessionCookies({ cookie } as unknown as Response, result, config.isProduction);
    expect(cookie).toHaveBeenCalledWith(
      'ez_refresh',
      'refresh',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax' }),
    );
    expect((cookie.mock.calls[1] as any)[2]).not.toHaveProperty('expires');
    setSessionCookies(
      { cookie } as unknown as Response,
      { ...result, rememberMe: true },
      config.isProduction,
    );
    expect((cookie.mock.calls[3] as any)[2]).toHaveProperty('expires');
  });
});
