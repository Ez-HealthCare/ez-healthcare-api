import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { Role } from '../../user/enums/role.enum';

export class UpdateStaffUserDto {
  @ApiPropertyOptional({ description: 'Full name of staff member', example: 'BS. Nguyễn Văn A' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Contact phone number', example: '0912345678' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    enum: Role,
    description: 'Updated role',
    example: Role.DOCTOR,
  })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ description: 'National Citizen ID (CCCD)', example: '079201000123' })
  @IsOptional()
  @IsString()
  nationalId?: string;

  @ApiPropertyOptional({ description: 'Gender (Nam, Nữ, Khác)', example: 'Nam' })
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiPropertyOptional({ description: 'Account active status', example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
