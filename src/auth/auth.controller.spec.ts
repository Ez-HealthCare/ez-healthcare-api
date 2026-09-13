import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

describe('AuthController', () => {
  let authController: AuthController;
  let authService: AuthService;

  const mockAuthResponse = {
    accessToken: 'mock_access_token',
    refreshToken: 'mock_refresh_token',
    user: {
      id: 'uuid-1',
      email: 'admin@ezhealthcare.com',
      name: 'Administrator',
      isActive: true,
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            login: jest.fn().mockResolvedValue(mockAuthResponse),
            refreshTokens: jest.fn().mockResolvedValue(mockAuthResponse),
            logout: jest
              .fn()
              .mockResolvedValue({ success: true, message: 'Đăng xuất thành công.' }),
            getProfile: jest.fn().mockResolvedValue(mockAuthResponse.user),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    authController = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(authController).toBeDefined();
  });

  describe('POST /api/auth/login', () => {
    it('should delegate login credentials to authService.login and return auth response', async () => {
      const loginDto = { email: 'admin@ezhealthcare.com', password: 'Admin@123456' };
      const result = await authController.login(loginDto);

      expect(authService.login).toHaveBeenCalledWith(loginDto);
      expect(result).toEqual(mockAuthResponse);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should delegate refresh token to authService.refreshTokens and return new token pair', async () => {
      const refreshTokenDto = { refreshToken: 'mock_refresh_token' };
      const result = await authController.refreshTokens(refreshTokenDto);

      expect(authService.refreshTokens).toHaveBeenCalledWith(refreshTokenDto);
      expect(result).toEqual(mockAuthResponse);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should delegate logout to authService.logout', async () => {
      const refreshTokenDto = { refreshToken: 'mock_refresh_token' };
      const result = await authController.logout(refreshTokenDto);

      expect(authService.logout).toHaveBeenCalledWith(refreshTokenDto);
      expect(result.success).toBe(true);
    });
  });

  describe('GET /api/auth/profile', () => {
    it('should extract user id from request and return profile', async () => {
      const req = { user: { id: 'uuid-1' } };
      const result = await authController.getProfile(req);

      expect(authService.getProfile).toHaveBeenCalledWith('uuid-1');
      expect(result).toEqual(mockAuthResponse.user);
    });
  });
});
