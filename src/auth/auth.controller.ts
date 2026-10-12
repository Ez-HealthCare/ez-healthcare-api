import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginStaffDto } from './dto/login-staff.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { toMeResponse } from '../common/dto/response.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('patient/request-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request 6-digit OTP code for patient login/registration' })
  @ApiResponse({ status: 200, description: 'OTP dispatched successfully' })
  @ApiResponse({ status: 400, description: 'Invalid email address' })
  @ApiResponse({
    status: 429,
    description: 'Account locked for 15 minutes due to multiple failures',
  })
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestPatientOtp(dto);
  }

  @Post('patient/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify patient OTP and retrieve JWT session token' })
  @ApiResponse({ status: 200, description: 'Patient authenticated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP code' })
  @ApiResponse({ status: 429, description: 'Account locked due to 3 failed attempts' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyPatientOtp(dto);
  }

  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Healthcare staff login (Doctor, Nurse, Receptionist, Lab Tech, Admin)',
  })
  @ApiResponse({ status: 200, description: 'Staff authenticated successfully' })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  async loginStaff(@Body() dto: LoginStaffDto) {
    return this.authService.loginStaff(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify accessToken and retrieve authenticated user profile and role' })
  @ApiResponse({
    status: 200,
    description: 'Verified user profile with role returned — password is never included',
  })
  @ApiResponse({ status: 401, description: 'Token is invalid, expired, or account deactivated' })
  async getMe(@Request() req: any) {
    // toMeResponse whitelists exactly which fields are safe to return;
    // adding a new sensitive column to the entity will NOT leak it here.
    return toMeResponse(req.user);
  }
}
