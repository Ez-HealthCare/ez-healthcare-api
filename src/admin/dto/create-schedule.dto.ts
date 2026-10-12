import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ShiftType } from '../../department/enums/shift-type.enum';

export class CreateScheduleDto {
  @ApiProperty({ description: 'Doctor UUID', example: 'uuid-doctor' })
  @IsNotEmpty()
  @IsUUID()
  doctorId: string;

  @ApiProperty({ description: 'Department code (e.g. P.102)', example: 'P.102' })
  @IsNotEmpty()
  @IsString()
  departmentCode: string;

  @ApiProperty({ description: 'Shift date (YYYY-MM-DD)', example: '2026-10-15' })
  @IsNotEmpty()
  @IsString()
  shiftDate: string;

  @ApiProperty({
    enum: ShiftType,
    description: 'Shift type (MORNING or AFTERNOON)',
    example: ShiftType.MORNING,
  })
  @IsNotEmpty()
  @IsEnum(ShiftType)
  shiftType: ShiftType;

  @ApiPropertyOptional({ description: 'Maximum quota for shift', example: 40, default: 40 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxQuota?: number;
}
