import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { RecordVitalsDto } from './record-vitals.dto';

export class RecordIntakeDto extends RecordVitalsDto {
  @ApiProperty({ description: 'Primary complaint recorded by reception staff' })
  @IsNotEmpty()
  @IsString()
  chiefComplaint: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  symptomOnset?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  symptomDuration?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  symptomSeverity?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  allergies?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPriority?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  priorityReason?: string;
}
