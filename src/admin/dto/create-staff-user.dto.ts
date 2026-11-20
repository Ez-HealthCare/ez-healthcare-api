import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { Role } from '../../user/enums/role.enum';

export class CreateStaffUserDto {
  @ApiProperty({ description: 'Full name of staff member', example: 'BS. Nguyễn Văn A' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Work or personal email address',
    example: 'doctor.nguyenvana@hospital.vn',
  })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Initial password (min 6 characters)',
    example: 'Doctor@123',
    minLength: 6,
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({
    enum: Role,
    description: 'Assigned hospital role',
    example: Role.DOCTOR,
  })
  @IsNotEmpty()
  @IsEnum(Role)
  role: Role;

  @ApiPropertyOptional({ description: 'Contact phone number', example: '0912345678' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: 'National Citizen ID (CCCD)', example: '079201000123' })
  @IsOptional()
  @IsString()
  nationalId?: string;

  @ApiPropertyOptional({ description: 'Gender (Nam, Nữ, Khác)', example: 'Nam' })
  @IsOptional()
  @IsString()
  gender?: string;
}
