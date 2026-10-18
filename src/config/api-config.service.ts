import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isEmail } from 'class-validator';
import * as dotenv from 'dotenv';
import {
  DATABASE_DEFAULTS,
  DEFAULT_API_PORT,
  DEFAULT_WEB_ORIGIN,
  DEV_SIGNATURE_SECRET,
} from '../common/constants/app.constants';
import {
  DEV_JWT_SECRET,
  JWT_SECRET_MIN_LENGTH,
  OTP_DEFAULT_FROM,
} from '../common/constants/auth.constants';

@Injectable()
export class ApiConfigService {
  constructor(private readonly env: ConfigService) {}

  // CLI/seed entry points do not run a Nest container. Use the same config reader
  // after loading .env, but only validate the database settings they actually need.
  static fromEnvironment(): ApiConfigService {
    dotenv.config();
    return new ApiConfigService(new ConfigService());
  }

  get isProduction(): boolean {
    return this.value('NODE_ENV') === 'production';
  }

  get port(): number {
    return this.portNumber('PORT', DEFAULT_API_PORT);
  }

  get database() {
    return {
      type: 'postgres' as const,
      host: this.value('DB_HOST', DATABASE_DEFAULTS.host),
      port: this.portNumber('DB_PORT', DATABASE_DEFAULTS.port),
      username: this.value('DB_USERNAME', DATABASE_DEFAULTS.username),
      password: this.value('DB_PASSWORD', DATABASE_DEFAULTS.password),
      database: this.value('DB_DATABASE', DATABASE_DEFAULTS.database),
      synchronize: this.boolean('DB_SYNC'),
      logging: this.boolean('DB_LOGGING'),
    };
  }

  get jwtSecret(): string {
    const secret = this.value('JWT_ACCESS_SECRET');
    if (secret.length >= JWT_SECRET_MIN_LENGTH) return secret;
    if (this.isProduction) {
      throw new Error(
        `JWT_ACCESS_SECRET must contain at least ${JWT_SECRET_MIN_LENGTH} characters`,
      );
    }
    return DEV_JWT_SECRET;
  }

  get signatureSecret(): string {
    return this.value('SIGNATURE_SECRET', DEV_SIGNATURE_SECRET);
  }

  get corsOrigins(): string[] {
    return this.value('CORS_ORIGINS', DEFAULT_WEB_ORIGIN)
      .split(',')
      .map((entry) => {
        const url = this.httpUrl(entry.trim(), 'CORS_ORIGINS');
        if (url.pathname !== '/' || url.search || url.hash) {
          throw new Error('CORS_ORIGINS must contain only HTTP(S) origins');
        }
        return url.origin;
      });
  }

  get otpDelivery() {
    const url = this.value('OTP_DELIVERY_URL');
    if (url) this.httpUrl(url, 'OTP_DELIVERY_URL');
    const from = this.value('OTP_FROM', OTP_DEFAULT_FROM);
    if (!isEmail(from)) throw new Error('OTP_FROM must be a valid email address');
    const authorization = this.value('OTP_DELIVERY_AUTH');
    if (/[\r\n]/.test(authorization)) {
      throw new Error('OTP_DELIVERY_AUTH must not contain line breaks');
    }
    return { url: url || undefined, from, authorization: authorization || undefined };
  }

  // Called by ApiConfigModule before consumers (JWT/database) are constructed.
  validate(): void {
    void this.port;
    void this.database;
    void this.jwtSecret;
    void this.corsOrigins;
    void this.otpDelivery;
  }

  private value(key: string, fallback = ''): string {
    const value = this.env.get<unknown>(key);
    return value === undefined || value === null || value === '' ? fallback : String(value);
  }

  private portNumber(key: string, fallback: number): number {
    const value = this.value(key, String(fallback)).trim();
    const port = Number(value);
    if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`${key} must be an integer between 1 and 65535`);
    }
    return port;
  }

  private boolean(key: string): boolean {
    const value = this.value(key, 'false');
    if (value !== 'true' && value !== 'false') {
      throw new Error(`${key} must be true or false`);
    }
    return value === 'true';
  }

  private httpUrl(value: string, key: string): URL {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error();
      }
      return url;
    } catch {
      // Never include a supplied value: URLs may contain mail credentials.
      throw new Error(`${key} must be a valid HTTP(S) URL without embedded credentials`);
    }
  }
}
