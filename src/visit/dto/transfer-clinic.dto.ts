import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class EmergencyDispatchDto {
  @ApiProperty({
    description: 'Clinical emergency rationale',
    example: 'Sudden loss of consciousness and cyanosis',
  })
  @IsNotEmpty()
  @IsString()
  reason: string;
}

export class TransferClinicDto {
  @ApiProperty({ description: 'Target clinical department code to transfer to', example: 'P.108' })
  @IsNotEmpty()
  @IsString()
  targetDepartmentCode: string;

  @ApiProperty({
    description: 'Medical rationale for specialty clinic transfer',
    example: 'Suspected acute appendicitis requiring surgical evaluation',
  })
  @IsNotEmpty()
  @IsString()
  transferReason: string;

  @ApiPropertyOptional({
    description: 'Clinical summary and exam findings transferred to receiving doctor',
    example: 'Right lower quadrant abdominal rebound tenderness.',
  })
  @IsOptional()
  @IsString()
  clinicalSummary?: string;
}
