import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { RoomType } from '../../department/enums/room-type.enum';

export class CreateDepartmentDto {
  @ApiProperty({ description: 'Unique code for department (e.g. P.109)', example: 'P.109' })
  @IsNotEmpty()
  @IsString()
  code: string;

  @ApiProperty({
    description: 'Department or clinic name',
    example: 'Dermatology Consultation Clinic',
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ enum: RoomType, description: 'Type of room', example: RoomType.CONSULTATION })
  @IsNotEmpty()
  @IsEnum(RoomType)
  roomType: RoomType;

  @ApiPropertyOptional({ description: 'Floor number', example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  floor?: number;

  @ApiPropertyOptional({
    description: 'Average service duration in minutes',
    example: 15,
    default: 15,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  avgServiceTimeMin?: number;

  @ApiPropertyOptional({
    description: 'Maximum quota of patients per shift slot',
    example: 35,
    default: 40,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxQuotaPerSlot?: number;
}
