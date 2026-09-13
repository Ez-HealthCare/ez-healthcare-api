import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AUTH_CONSTANTS } from '../../auth/constants/auth.constants';
import { APP_CONSTANTS } from '../../common/constants/app.constants';
import { ENV_KEYS } from '../../common/constants/env.constants';
import { parseBoolean, parseInteger } from '../../common/utils/parser.util';
import { DATABASE_CONSTANTS } from '../../database/constants/database.constants';

@Injectable()
export class ApiConfigService {
  constructor(private readonly configService: ConfigService) {}

  // --- Ứng Dụng ---
  get port(): number {
    const rawPort = this.configService.get<string | number>(ENV_KEYS.PORT);
    return parseInteger(rawPort, APP_CONSTANTS.DEFAULT_PORT);
  }

  get nodeEnv(): string {
    return this.configService.get<string>(ENV_KEYS.NODE_ENV) || APP_CONSTANTS.ENV_DEVELOPMENT;
  }

  get isProduction(): boolean {
    return this.nodeEnv === APP_CONSTANTS.ENV_PRODUCTION;
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === APP_CONSTANTS.ENV_DEVELOPMENT;
  }

  // --- Cơ Sở Dữ Liệu PostgreSQL ---
  get dbType(): 'postgres' {
    return DATABASE_CONSTANTS.TYPE;
  }

  get dbHost(): string {
    return this.configService.get<string>(ENV_KEYS.DB_HOST) || DATABASE_CONSTANTS.DEFAULT_HOST;
  }

  get dbPort(): number {
    const rawPort = this.configService.get<string | number>(ENV_KEYS.DB_PORT);
    return parseInteger(rawPort, DATABASE_CONSTANTS.DEFAULT_PORT);
  }

  get dbUsername(): string {
    return (
      this.configService.get<string>(ENV_KEYS.DB_USERNAME) || DATABASE_CONSTANTS.DEFAULT_USERNAME
    );
  }

  get dbPassword(): string {
    return (
      this.configService.get<string>(ENV_KEYS.DB_PASSWORD) || DATABASE_CONSTANTS.DEFAULT_PASSWORD
    );
  }

  get dbDatabase(): string {
    return (
      this.configService.get<string>(ENV_KEYS.DB_DATABASE) || DATABASE_CONSTANTS.DEFAULT_DATABASE
    );
  }

  get dbSync(): boolean {
    return parseBoolean(
      this.configService.get<string | boolean>(ENV_KEYS.DB_SYNC) ?? DATABASE_CONSTANTS.DEFAULT_SYNC,
    );
  }

  get dbLogging(): boolean {
    return parseBoolean(
      this.configService.get<string | boolean>(ENV_KEYS.DB_LOGGING) ??
        DATABASE_CONSTANTS.DEFAULT_LOGGING,
    );
  }

  // --- JWT Authentication ---
  get jwtAccessSecret(): string {
    return (
      this.configService.get<string>(ENV_KEYS.JWT_ACCESS_SECRET) ||
      AUTH_CONSTANTS.DEFAULT_JWT_ACCESS_SECRET
    );
  }

  get jwtAccessExpiration(): string {
    return (
      this.configService.get<string>(ENV_KEYS.JWT_ACCESS_EXPIRATION) ||
      AUTH_CONSTANTS.DEFAULT_JWT_ACCESS_EXPIRATION
    );
  }

  get jwtRefreshSecret(): string {
    return (
      this.configService.get<string>(ENV_KEYS.JWT_REFRESH_SECRET) ||
      AUTH_CONSTANTS.DEFAULT_JWT_REFRESH_SECRET
    );
  }

  get jwtRefreshExpiration(): string {
    return (
      this.configService.get<string>(ENV_KEYS.JWT_REFRESH_EXPIRATION) ||
      AUTH_CONSTANTS.DEFAULT_JWT_REFRESH_EXPIRATION
    );
  }

  get frontendUrl(): string | undefined {
    return this.configService.get<string>(ENV_KEYS.FRONTEND_URL);
  }
}

// Alias ApiService để thuận tiện sử dụng theo đúng yêu cầu
export { ApiConfigService as ApiService };
