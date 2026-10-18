import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { STAFF_PASSWORD_MIN_LENGTH } from '../../common/constants/auth.constants';

export class LoginStaffDto {
  @ApiProperty({
    example: 'dr.smith@ezhealthcare.com',
    description: 'Healthcare staff official email',
  })
  @IsEmail({}, { message: 'Invalid email address format' })
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email: string;

  @ApiProperty({ example: 'Doctor@123456', description: 'Password' })
  @IsNotEmpty()
  @MinLength(STAFF_PASSWORD_MIN_LENGTH, { message: 'Password must be at least 6 characters' })
  password: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
