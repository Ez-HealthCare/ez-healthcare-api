import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { OTP_PATTERN } from '../../common/constants/auth.constants';

export class VerifyOtpDto {
  @ApiProperty({ example: 'patient.david@example.com', description: 'Patient email address' })
  @IsEmail({}, { message: 'Invalid email address format' })
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email: string;

  @ApiProperty({ example: '123456', description: '6-digit OTP code' })
  @IsNotEmpty()
  @Matches(OTP_PATTERN, { message: 'OTP code must be exactly 6 digits' })
  otpCode: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
