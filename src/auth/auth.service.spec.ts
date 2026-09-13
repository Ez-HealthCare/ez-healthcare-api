import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { ApiConfigService } from '../core/services/api-config.service';
import { User } from '../user/entities/user.entity';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';

describe('AuthService (Auth0 Refresh Token Rotation & Reuse Detection Concept)', () => {
  let authService: AuthService;
  let jwtService: JwtService;

  // Mock User
  const mockPasswordPlain = 'Admin@123456';
  const mockPasswordHash = bcrypt.hashSync(mockPasswordPlain, 10);
  const mockUser: Partial<User> = {
    id: 'user-uuid-1234',
    email: 'admin@ezhealthcare.com',
    password: mockPasswordHash,
    name: 'Administrator',
    isActive: true,
  };

  // Mock Repositories
  let mockUserRepo: any;
  let mockRefreshTokenRepo: any;

  beforeEach(async () => {
    mockUserRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockUser),
      }),
      findOne: jest.fn().mockResolvedValue(mockUser),
    };

    mockRefreshTokenRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'rt-uuid-1', ...dto })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepo,
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: mockRefreshTokenRepo,
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn().mockImplementation((payload) => {
              if (payload.tokenType === 'refresh' || payload.familyId) {
                return Promise.resolve(
                  `mock_refresh_token_for_${payload.sub}_family_${payload.familyId}`,
                );
              }
              return Promise.resolve(`mock_access_token_for_${payload.sub}`);
            }),
            verifyAsync: jest.fn(),
          },
        },
        {
          provide: ApiConfigService,
          useValue: {
            jwtAccessSecret: 'test_access_secret',
            jwtAccessExpiration: '15m',
            jwtRefreshSecret: 'test_refresh_secret',
            jwtRefreshExpiration: '7d',
          },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
  });

  describe('1. Login & Token Issuance (OAuth 2.0 / Auth0 Concept)', () => {
    it('should authenticate user, issue short-lived access token + refresh token with a new token family', async () => {
      const result = await authService.login({
        email: 'admin@ezhealthcare.com',
        password: mockPasswordPlain,
      });

      // Verification of Auth0 Token issuance
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        isActive: mockUser.isActive,
      });

      // Ensure NO sensitive data is leaked
      expect((result.user as any).password).toBeUndefined();

      // Ensure Refresh Token is stored as hash with a unique familyId
      expect(mockRefreshTokenRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUser.id,
          tokenHash: expect.any(String),
          familyId: expect.any(String),
          isRevoked: false,
          expiresAt: expect.any(Date),
        }),
      );
      expect(mockRefreshTokenRepo.save).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when password does not match', async () => {
      await expect(
        authService.login({
          email: 'admin@ezhealthcare.com',
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user does not exist', async () => {
      mockUserRepo.createQueryBuilder.mockReturnValueOnce({
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });

      await expect(
        authService.login({
          email: 'nonexistent@ezhealthcare.com',
          password: mockPasswordPlain,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user is inactive', async () => {
      mockUserRepo.createQueryBuilder.mockReturnValueOnce({
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ ...mockUser, isActive: false }),
      });

      await expect(
        authService.login({
          email: 'admin@ezhealthcare.com',
          password: mockPasswordPlain,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('2. Refresh Token Rotation (RTR)', () => {
    const rawRefreshToken = 'valid_raw_refresh_token_1';
    const familyId = 'family-uuid-123';
    const rawTokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

    it('should rotate token: invalidate old refresh token and issue a new token pair maintaining the family lineage', async () => {
      // Mock valid JWT decoding
      (jwtService.verifyAsync as jest.Mock).mockResolvedValueOnce({
        sub: mockUser.id,
        familyId,
      });

      // Existing active token in DB
      const existingToken: Partial<RefreshToken> = {
        id: 'rt-id-1',
        userId: mockUser.id!,
        tokenHash: rawTokenHash,
        familyId,
        isRevoked: false,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24), // expires in 1 day
      };
      mockRefreshTokenRepo.findOne.mockResolvedValueOnce(existingToken);

      const result = await authService.refreshTokens({ refreshToken: rawRefreshToken });

      // Old token must be invalidated
      expect(existingToken.isRevoked).toBe(true);
      expect(mockRefreshTokenRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'rt-id-1', isRevoked: true }),
      );

      // New token must be issued keeping the SAME familyId
      expect(mockRefreshTokenRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUser.id,
          familyId,
          isRevoked: false,
        }),
      );

      // Response contains fresh access token and fresh refresh token
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe(mockUser.email);
    });

    it('should throw UnauthorizedException when refresh token has expired', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValueOnce({
        sub: mockUser.id,
        familyId,
      });

      const expiredToken: Partial<RefreshToken> = {
        id: 'rt-id-expired',
        userId: mockUser.id!,
        tokenHash: rawTokenHash,
        familyId,
        isRevoked: false,
        expiresAt: new Date(Date.now() - 1000 * 60), // expired 1 minute ago
      };
      mockRefreshTokenRepo.findOne.mockResolvedValueOnce(expiredToken);

      await expect(authService.refreshTokens({ refreshToken: rawRefreshToken })).rejects.toThrow(
        UnauthorizedException,
      );

      expect(expiredToken.isRevoked).toBe(true);
      expect(mockRefreshTokenRepo.save).toHaveBeenCalledWith(expiredToken);
    });
  });

  describe('3. Automatic Reuse Detection (Anti-Replay Attack Protection)', () => {
    const rawRevokedToken = 'replayed_compromised_refresh_token';
    const familyId = 'compromised-family-uuid-456';
    const revokedTokenHash = crypto.createHash('sha256').update(rawRevokedToken).digest('hex');

    it('should detect reuse of a previously invalidated token and immediately revoke the entire token family', async () => {
      // Mock valid signature verification
      (jwtService.verifyAsync as jest.Mock).mockResolvedValueOnce({
        sub: mockUser.id,
        familyId,
      });

      // Token in DB is already revoked!
      const alreadyRevokedToken: Partial<RefreshToken> = {
        id: 'rt-id-old',
        userId: mockUser.id!,
        tokenHash: revokedTokenHash,
        familyId,
        isRevoked: true, // Already consumed previously
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      };
      mockRefreshTokenRepo.findOne.mockResolvedValueOnce(alreadyRevokedToken);

      // Attempting to refresh with an already-revoked token triggers reuse detection
      await expect(authService.refreshTokens({ refreshToken: rawRevokedToken })).rejects.toThrow(
        /Phát hiện tái sử dụng Refresh Token/i,
      );

      // Crucial Auth0 requirement: Revoke ALL tokens belonging to this family
      expect(mockRefreshTokenRepo.update).toHaveBeenCalledWith({ familyId }, { isRevoked: true });
    });

    it('should throw UnauthorizedException when refresh token signature is invalid', async () => {
      (jwtService.verifyAsync as jest.Mock).mockRejectedValueOnce(new Error('jwt malformed'));

      await expect(
        authService.refreshTokens({ refreshToken: 'invalid.jwt.token' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when refresh token is not found in database', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValueOnce({
        sub: mockUser.id,
        familyId,
      });
      mockRefreshTokenRepo.findOne.mockResolvedValueOnce(null);

      await expect(authService.refreshTokens({ refreshToken: 'not_in_db_token' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('4. Logout & Token Invalidation', () => {
    it('should revoke refresh token upon logout', async () => {
      const rawToken = 'logout_token';
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      const existingToken: Partial<RefreshToken> = {
        id: 'rt-logout',
        tokenHash,
        isRevoked: false,
      };
      mockRefreshTokenRepo.findOne.mockResolvedValueOnce(existingToken);

      const result = await authService.logout({ refreshToken: rawToken });

      expect(result.success).toBe(true);
      expect(existingToken.isRevoked).toBe(true);
      expect(mockRefreshTokenRepo.save).toHaveBeenCalledWith(existingToken);
    });
  });

  describe('5. User Profile (Safe Data Exposure)', () => {
    it('should return sanitized user profile without sensitive fields', async () => {
      const profile = await authService.getProfile(mockUser.id!);

      expect(profile).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        isActive: mockUser.isActive,
      });
      expect((profile as any).password).toBeUndefined();
    });

    it('should throw UnauthorizedException if user not found', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce(null);

      await expect(authService.getProfile('nonexistent-id')).rejects.toThrow(UnauthorizedException);
    });
  });
});
