import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { jest } from '@jest/globals';
import { ESLint } from 'eslint';
import type { Request, Response } from 'express';
import { ApiConfigService } from './api-config.service';
import { ApiConfigModule } from './api-config.module';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { AuthController } from '../auth/auth.controller';
import { User } from '../database/entities/user.entity';
import { PatientOtp } from '../auth/entities/patient-otp.entity';
import { AuthSession } from '../auth/entities/auth-session.entity';

const keys = [
  'NODE_ENV',
  'PORT',
  'JWT_ACCESS_SECRET',
  'SIGNATURE_SECRET',
  'CORS_ORIGINS',
  'OTP_DELIVERY_URL',
  'OTP_FROM',
  'OTP_DELIVERY_AUTH',
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_DATABASE',
  'DB_SYNC',
  'DB_LOGGING',
  'QUEUE_ISSUANCE_WINDOWS',
];
function environment(values: Record<string, string> = {}) {
  // Explicit empty values prevent developer-shell/.env values affecting unit fixtures.
  return new ConfigService({ ...Object.fromEntries(keys.map((key) => [key, ''])), ...values });
}
function config(values: Record<string, string> = {}) {
  return new ApiConfigService(environment(values));
}

describe('ApiConfigService', () => {
  it('preserves local defaults and leaves OTP unconfigured rather than inventing delivery', () => {
    const settings = config();
    expect(() => settings.validate()).not.toThrow();
    expect(settings.port).toBe(3000);
    expect(settings.isProduction).toBe(false);
    expect(settings.database).toEqual({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'postgres',
      database: 'tlcn_api_db',
      synchronize: false,
      logging: false,
    });
    expect(settings.corsOrigins).toEqual(['http://localhost:3001']);
    expect(settings.otpDelivery).toEqual({
      url: undefined,
      authorization: undefined,
      from: 'no-reply@ezhealthcare.test',
    });
    expect(settings.jwtSecret).toBe('local-development-only-change-this-secret');
    expect(settings.signatureSecret).toBe('ez-healthcare-dev-key');
  });

  it('parses the env contract into typed config without losing false or secret characters', () => {
    const settings = config({
      NODE_ENV: 'production',
      PORT: '3100',
      DB_HOST: 'db',
      DB_PORT: '5434',
      DB_USERNAME: 'app',
      DB_PASSWORD: ' leading and trailing ',
      DB_DATABASE: 'clinic',
      DB_SYNC: 'false',
      DB_LOGGING: 'true',
      JWT_ACCESS_SECRET: 'x'.repeat(32),
      SIGNATURE_SECRET: 'configured-signature-secret',
      CORS_ORIGINS: 'https://portal.example.com, http://localhost:3001/',
      OTP_DELIVERY_URL: 'https://mail.example.com/api/send',
      OTP_FROM: 'otp@example.com',
      OTP_DELIVERY_AUTH: 'Bearer fixture-only',
    });
    settings.validate();
    expect(settings.port).toBe(3100);
    expect(settings.database.port).toBe(5434);
    expect(settings.database.synchronize).toBe(false);
    expect(settings.database.logging).toBe(true);
    expect(settings.database.password).toBe(' leading and trailing ');
    expect(settings.jwtSecret).toBe('x'.repeat(32));
    expect(settings.signatureSecret).toBe('configured-signature-secret');
    expect(settings.isProduction).toBe(true);
    expect(settings.corsOrigins).toEqual(['https://portal.example.com', 'http://localhost:3001']);
    expect(settings.otpDelivery.authorization).toBe('Bearer fixture-only');
  });

  it.each(['PORT', 'DB_PORT'])('rejects invalid %s instead of accepting partial numbers', (key) => {
    for (const value of ['0', '-1', '65536', '3000abc', '3.5', 'NaN', ' ']) {
      expect(() => config({ [key]: value }).validate()).toThrow(key);
    }
  });

  it.each(['DB_SYNC', 'DB_LOGGING'])('rejects invalid boolean %s', (key) => {
    for (const value of ['1', 'yes', 'FALSE']) {
      expect(() => config({ [key]: value }).validate()).toThrow(key);
    }
  });

  it('rejects weak production JWT secrets and keeps a development-only fallback', () => {
    for (const secret of ['', 'weak']) {
      expect(() =>
        config({ NODE_ENV: 'production', JWT_ACCESS_SECRET: secret }).validate(),
      ).toThrow('JWT_ACCESS_SECRET');
    }
    expect(() =>
      config({ NODE_ENV: 'development', JWT_ACCESS_SECRET: 'weak' }).validate(),
    ).not.toThrow();
  });

  it('validates exact CORS origins and HTTP(S) mail URLs without leaking supplied values', () => {
    for (const value of [
      '*',
      'null',
      'https://site.example/path',
      'https://site.example?token=secret',
      'https://site.example,',
    ]) {
      expect(() => config({ CORS_ORIGINS: value }).validate()).toThrow('CORS_ORIGINS');
    }
    for (const value of ['not-a-url', 'file:///mail', 'https://user:credential@example.com/send']) {
      expect(() => config({ OTP_DELIVERY_URL: value }).validate()).toThrow('OTP_DELIVERY_URL');
      expect(() => config({ OTP_DELIVERY_URL: value }).validate()).not.toThrow(value);
    }
    expect(() => config({ OTP_FROM: 'not-an-email' }).validate()).toThrow('OTP_FROM');
    expect(() =>
      config({ OTP_DELIVERY_AUTH: 'Bearer secret\nInjected: value' }).validate(),
    ).toThrow('OTP_DELIVERY_AUTH');
  });

  it('allows database-only readers in production without requiring unrelated JWT/mail config', () => {
    const settings = config({ NODE_ENV: 'production', DB_PORT: '5434' });
    expect(settings.database.port).toBe(5434);
    expect(() => settings.validate()).toThrow('JWT_ACCESS_SECRET');
  });

  it('validates clinic windows as ordered, non-overlapping real HH:mm ranges', () => {
    expect(
      config({ QUEUE_ISSUANCE_WINDOWS: '07:00-11:30,13:00-16:30' }).queueIssuanceWindows,
    ).toEqual([
      { start: '07:00', end: '11:30' },
      { start: '13:00', end: '16:30' },
    ]);
    for (const value of [
      '07:00-11:30',
      '24:00-25:00,13:00-16:30',
      '07:60-11:30,13:00-16:30',
      '07:00-14:00,13:00-16:30',
      '11:30-07:00,13:00-16:30',
    ]) {
      expect(() => config({ QUEUE_ISSUANCE_WINDOWS: value }).queueIssuanceWindows).toThrow(
        'QUEUE_ISSUANCE_WINDOWS',
      );
    }
  });

  it('wires the real AuthModule/JWT/controller to the config provider without a database', async () => {
    const fixture = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(ConfigService)
      .useValue(
        environment({
          NODE_ENV: 'production',
          JWT_ACCESS_SECRET: 'x'.repeat(32),
          PORT: '3100',
        }),
      )
      .overrideProvider(getRepositoryToken(User))
      .useValue({})
      .overrideProvider(getRepositoryToken(PatientOtp))
      .useValue({})
      .overrideProvider(getRepositoryToken(AuthSession))
      .useValue({})
      .compile();
    try {
      expect(fixture.get(ApiConfigService).port).toBe(3100);
      expect(fixture.get(AuthService)).toBeInstanceOf(AuthService);
      const jwt = fixture.get(JwtService);
      expect(jwt.verify(jwt.sign({ sub: 'fixture' }), { secret: 'x'.repeat(32) }).sub).toBe(
        'fixture',
      );
      const clearCookie = jest.fn();
      await fixture
        .get(AuthController)
        .logout({ headers: {} } as Request, { clearCookie } as unknown as Response);
      expect(clearCookie).toHaveBeenCalledWith(
        'ez_access',
        expect.objectContaining({ secure: true, httpOnly: true }),
      );
      expect(clearCookie).toHaveBeenCalledWith(
        'ez_refresh',
        expect.objectContaining({ secure: true, httpOnly: true }),
      );
    } finally {
      await fixture.close();
    }
  });

  it('fails config-module initialization before exposing an invalid configuration', async () => {
    await expect(
      Test.createTestingModule({ imports: [ApiConfigModule] })
        .overrideProvider(ConfigService)
        .useValue(environment({ PORT: 'invalid' }))
        .compile(),
    ).rejects.toThrow('PORT');
  });

  it('lint forbids bypassing the config boundary in runtime consumers', async () => {
    const eslint = new ESLint();
    const [rawEnv] = await eslint.lintText('export const port = process.env.PORT;', {
      filePath: 'src/auth/example.ts',
    });
    expect(rawEnv.messages.some((message) => message.ruleId === 'no-restricted-properties')).toBe(
      true,
    );
    const [directConfig] = await eslint.lintText(
      "import { ConfigService } from '@nestjs/config'; void ConfigService;",
      { filePath: 'src/auth/example.ts' },
    );
    expect(
      directConfig.messages.some((message) => message.ruleId === 'no-restricted-imports'),
    ).toBe(true);
    const [allowed] = await eslint.lintText(
      "import { ApiConfigService } from '../config/api-config.service'; void ApiConfigService;",
      { filePath: 'src/auth/example.ts' },
    );
    expect(allowed.errorCount).toBe(0);
  });
});
