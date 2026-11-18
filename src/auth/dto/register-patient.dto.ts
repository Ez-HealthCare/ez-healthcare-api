import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterPatientDto {
  @ApiProperty({ example: 'patient@example.com', description: 'Patient email address' })
  @IsEmail({}, { message: 'Invalid email address format' })
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email: string;

  @ApiProperty({ example: 'Patient@123456', description: 'Patient password' })
  @IsNotEmpty()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password: string;

  @ApiProperty({ example: 'Nguyen Van A', description: 'Patient full name' })
  @IsNotEmpty()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name: string;

  @ApiProperty({ example: '0912345678', description: 'Phone number', required: false })
  @IsOptional()
  @IsString()
  phone?: string;
}
