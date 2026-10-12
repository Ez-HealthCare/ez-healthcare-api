import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AssignClinicDto {
  @ApiProperty({
    description: 'Target clinical department code (e.g., P.102, P.105, P.108)',
    example: 'P.102',
  })
  @IsNotEmpty()
  @IsString()
  departmentCode: string;

  @ApiPropertyOptional({
    description: 'Flag marking visit as high-priority (elderly > 80, pregnant, infant)',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isPriority?: boolean;

  @ApiPropertyOptional({
    description: 'Clinical rationale for granting queue priority',
    example: 'Elderly patient over 80 years old',
  })
  @IsOptional()
  @IsString()
  priorityReason?: string;
}
