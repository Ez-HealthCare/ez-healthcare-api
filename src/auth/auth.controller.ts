import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ApiConfigService } from '../config/api-config.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginStaffDto } from './dto/login-staff.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterPatientDto } from './dto/register-patient.dto';
import { VerifyRegisterDto } from './dto/verify-register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { clearSessionCookies, readCookie, setSessionCookies } from './auth.config';
import {
  AUTH_CONTROLLER_PATH,
  AUTH_PATHS,
  REFRESH_COOKIE,
} from '../common/constants/auth.constants';

@ApiTags('Authentication')
@Controller(AUTH_CONTROLLER_PATH)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ApiConfigService,
  ) {}

  private sendSession(res: Response, session: Awaited<ReturnType<AuthService['loginStaff']>>) {
    setSessionCookies(res, session, this.config.isProduction);
    // Refresh tokens are only delivered through the HttpOnly cookie.
    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  }

  @Post(AUTH_PATHS.REQUEST_OTP)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a 6-digit patient login code by email' })
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestPatientOtp(dto);
  }

  @Post(AUTH_PATHS.VERIFY_OTP)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify patient OTP and create an HttpOnly cookie session' })
  async verifyOtp(@Body() dto: VerifyOtpDto, @Res({ passthrough: true }) res: Response) {
    return this.sendSession(res, await this.authService.verifyPatientOtp(dto));
  }

  @Post(AUTH_PATHS.LOGIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate any role (Patient or Staff) with email and password' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.sendSession(res, await this.authService.login(dto));
  }

  @Post(AUTH_PATHS.REGISTER_PATIENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register a new patient account and send verification OTP' })
  registerPatient(@Body() dto: RegisterPatientDto) {
    return this.authService.registerPatient(dto);
  }

  @Post(AUTH_PATHS.VERIFY_REGISTER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify patient registration OTP and create an authenticated session' })
  async verifyRegister(@Body() dto: VerifyRegisterDto, @Res({ passthrough: true }) res: Response) {
    return this.sendSession(res, await this.authService.verifyPatientRegistration(dto));
  }

  @Post(AUTH_PATHS.STAFF_LOGIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate any staff role with email and password' })
  async loginStaff(@Body() dto: LoginStaffDto, @Res({ passthrough: true }) res: Response) {
    return this.sendSession(res, await this.authService.loginStaff(dto));
  }

  @Post(AUTH_PATHS.REFRESH)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the HttpOnly refresh token and renew the access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return this.sendSession(res, await this.authService.refresh(readCookie(req, REFRESH_COOKIE)));
    } catch (error) {
      clearSessionCookies(res, this.config.isProduction);
      throw error;
    }
  }

  @Post(AUTH_PATHS.LOGOUT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the current session and clear its cookies' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.logout(readCookie(req, REFRESH_COOKIE));
    clearSessionCookies(res, this.config.isProduction);
    return result;
  }

  @Get(AUTH_PATHS.ME)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return authenticated identity and Patient profile completion state' })
  getMe(@Req() req: Request & { user: unknown }) {
    return this.authService.getMe((req.user as { id: string }).id);
  }
}
