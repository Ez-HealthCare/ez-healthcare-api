import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import { ApiConfigService } from '../core/services/api-config.service';
import { User } from '../user/entities/user.entity';
import { AUTH_CONSTANTS } from './constants/auth.constants';
import { RefreshToken } from './entities/refresh-token.entity';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

export interface SanitizedUser {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: SanitizedUser;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly apiConfigService: ApiConfigService,
  ) {}

  private hashToken(token: string): string {
    return crypto
      .createHash(AUTH_CONSTANTS.HASH_ALGORITHM)
      .update(token)
      .digest(AUTH_CONSTANTS.HASH_ENCODING);
  }

  private sanitizeUser(user: User): SanitizedUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
    };
  }

  private async generateTokens(
    user: User,
    familyId: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const accessSecret = this.apiConfigService.jwtAccessSecret;
    const accessExpiration = this.apiConfigService.jwtAccessExpiration;
    const refreshSecret = this.apiConfigService.jwtRefreshSecret;
    const refreshExpiration = this.apiConfigService.jwtRefreshExpiration;

    const tokenId = crypto.randomUUID();

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        {
          sub: user.id,
          email: user.email,
        },
        {
          secret: accessSecret,
          expiresIn: accessExpiration as any,
        },
      ),
      this.jwtService.signAsync(
        {
          sub: user.id,
          jti: tokenId,
          familyId,
        },
        {
          secret: refreshSecret,
          expiresIn: refreshExpiration as any,
        },
      ),
    ]);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + AUTH_CONSTANTS.REFRESH_TOKEN_VALIDITY_DAYS);

    return { accessToken, refreshToken, expiresAt };
  }

  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const { email, password } = loginDto;

    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email: email.toLowerCase().trim() })
      .getOne();

    if (!user) {
      throw new UnauthorizedException(AUTH_CONSTANTS.ERRORS.INVALID_CREDENTIALS);
    }

    if (!user.isActive) {
      throw new UnauthorizedException(AUTH_CONSTANTS.ERRORS.ACCOUNT_INACTIVE);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException(AUTH_CONSTANTS.ERRORS.INVALID_CREDENTIALS);
    }

    // Auth0 Concept: New session begins a new Token Family
    const familyId = crypto.randomUUID();
    const { accessToken, refreshToken, expiresAt } = await this.generateTokens(user, familyId);

    // Save hashed refresh token to database
    const tokenEntity = this.refreshTokenRepository.create({
      userId: user.id,
      tokenHash: this.hashToken(refreshToken),
      familyId,
      isRevoked: false,
      expiresAt,
    });
    await this.refreshTokenRepository.save(tokenEntity);

    return {
      accessToken,
      refreshToken,
      user: this.sanitizeUser(user),
    };
  }

  async refreshTokens(refreshTokenDto: RefreshTokenDto): Promise<AuthResponse> {
    const { refreshToken: rawRefreshToken } = refreshTokenDto;
    const refreshSecret = this.apiConfigService.jwtRefreshSecret;

    try {
      await this.jwtService.verifyAsync(rawRefreshToken, {
        secret: refreshSecret,
      });
    } catch {
      throw new UnauthorizedException(AUTH_CONSTANTS.ERRORS.INVALID_REFRESH_TOKEN);
    }

    const tokenHash = this.hashToken(rawRefreshToken);
    const existingToken = await this.refreshTokenRepository.findOne({
      where: { tokenHash },
    });

    // Reuse Detection: If token does not exist or was already revoked
    if (!existingToken) {
      throw new UnauthorizedException(AUTH_CONSTANTS.ERRORS.TOKEN_NOT_FOUND);
    }

    if (existingToken.isRevoked) {
      // REPLAY ATTACK DETECTED: A previously consumed token is being reused!
      // Invalidate the entire token family as recommended by Auth0
      await this.refreshTokenRepository.update(
        { familyId: existingToken.familyId },
        { isRevoked: true },
      );

      throw new UnauthorizedException(AUTH_CONSTANTS.ERRORS.REUSE_DETECTED);
    }

    if (new Date() > existingToken.expiresAt) {
      existingToken.isRevoked = true;
      await this.refreshTokenRepository.save(existingToken);
      throw new UnauthorizedException(AUTH_CONSTANTS.ERRORS.TOKEN_EXPIRED);
    }

    const user = await this.userRepository.findOne({
      where: { id: existingToken.userId },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException(AUTH_CONSTANTS.ERRORS.USER_NOT_FOUND);
    }

    // Refresh Token Rotation: Revoke current token
    existingToken.isRevoked = true;
    await this.refreshTokenRepository.save(existingToken);

    // Issue new pair preserving the same Token Family
    const {
      accessToken,
      refreshToken: newRefreshToken,
      expiresAt,
    } = await this.generateTokens(user, existingToken.familyId);

    // Store new token in family
    const newTokenEntity = this.refreshTokenRepository.create({
      userId: user.id,
      tokenHash: this.hashToken(newRefreshToken),
      familyId: existingToken.familyId,
      isRevoked: false,
      expiresAt,
    });
    await this.refreshTokenRepository.save(newTokenEntity);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user: this.sanitizeUser(user),
    };
  }

  async logout(refreshTokenDto: RefreshTokenDto): Promise<{ success: boolean; message: string }> {
    const { refreshToken: rawRefreshToken } = refreshTokenDto;
    const tokenHash = this.hashToken(rawRefreshToken);

    const token = await this.refreshTokenRepository.findOne({
      where: { tokenHash },
    });

    if (token) {
      token.isRevoked = true;
      await this.refreshTokenRepository.save(token);
    }

    return {
      success: true,
      message: AUTH_CONSTANTS.MESSAGES.LOGOUT_SUCCESS,
    };
  }

  async getProfile(userId: string): Promise<SanitizedUser> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException(AUTH_CONSTANTS.ERRORS.USER_NOT_FOUND);
    }

    return this.sanitizeUser(user);
  }
}
