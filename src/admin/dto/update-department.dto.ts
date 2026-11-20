import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { RoomType } from '../../department/enums/room-type.enum';

export class UpdateDepartmentDto {
  @ApiPropertyOptional({
    description: 'Department or clinic name',
    example: 'Dermatology Consultation Clinic',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    enum: RoomType,
    description: 'Type of room',
    example: RoomType.CONSULTATION,
  })
  @IsOptional()
  @IsEnum(RoomType)
  roomType?: RoomType;

  @ApiPropertyOptional({ description: 'Floor number', example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  floor?: number;

  @ApiPropertyOptional({
    description: 'Average service duration in minutes',
    example: 15,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  avgServiceTimeMin?: number;

  @ApiPropertyOptional({
    description: 'Maximum quota of patients per shift slot',
    example: 40,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxQuotaPerSlot?: number;

  @ApiPropertyOptional({ description: 'Whether the department is currently active', example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
