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
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập người dùng bằng email và mật khẩu' })
  @ApiResponse({
    status: 200,
    description: 'Đăng nhập thành công, trả về access token và refresh token',
  })
  @ApiResponse({ status: 401, description: 'Thông tin đăng nhập không hợp lệ' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Làm mới Access Token bằng Refresh Token (Refresh Token Rotation & Reuse Detection)',
  })
  @ApiResponse({ status: 200, description: 'Cấp phát cặp token mới thành công' })
  @ApiResponse({
    status: 401,
    description: 'Token không hợp lệ, hết hạn hoặc phát hiện tái sử dụng',
  })
  async refreshTokens(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshTokens(refreshTokenDto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng xuất và thu hồi Refresh Token hiện tại' })
  @ApiResponse({ status: 200, description: 'Thu hồi token thành công' })
  async logout(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.logout(refreshTokenDto);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy thông tin người dùng hiện tại (yêu cầu Bearer Access Token)' })
  @ApiResponse({ status: 200, description: 'Thông tin cá nhân (không chứa dữ liệu nhạy cảm)' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực hoặc token không hợp lệ' })
  async getProfile(@Request() req: any) {
    return this.authService.getProfile(req.user.id);
  }
}
