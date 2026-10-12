import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class PrescriptionItemDto {
  @ApiProperty({ description: 'Name of the medication', example: 'Esomeprazole 40mg' })
  @IsNotEmpty()
  @IsString()
  medicationName: string;

  @ApiProperty({ description: 'Dosage specification', example: '40mg' })
  @IsNotEmpty()
  @IsString()
  dosage: string;

  @ApiPropertyOptional({
    description: 'Administration route (ORAL, TOPICAL, INJECTION)',
    example: 'ORAL',
    default: 'ORAL',
  })
  @IsOptional()
  @IsString()
  route?: string;

  @ApiProperty({ description: 'Dosing frequency', example: '1 tablet once daily before breakfast' })
  @IsNotEmpty()
  @IsString()
  frequency: string;

  @ApiPropertyOptional({
    description: 'Treatment duration in calendar days',
    example: 14,
    default: 7,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number;

  @ApiPropertyOptional({ description: 'Total units/tablets dispensed', example: 14, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({
    description: 'Patient specific instructions',
    example: 'Take 30 minutes before meal with full glass of water.',
  })
  @IsOptional()
  @IsString()
  instructions?: string;
}

export class ConcludeVisitDto {
  @ApiProperty({ description: 'Official ICD-10 diagnostic code', example: 'K29.7' })
  @IsNotEmpty()
  @IsString()
  icd10Code: string;

  @ApiProperty({
    description: 'Official ICD-10 diagnostic disease name',
    example: 'Gastritis, unspecified',
  })
  @IsNotEmpty()
  @IsString()
  icd10Name: string;

  @ApiPropertyOptional({
    description: 'Doctor clinical conclusion and dietary/lifestyle notes',
    example: 'Avoid spicy foods and NSAIDs. Take medication before meals.',
  })
  @IsOptional()
  @IsString()
  doctorNotes?: string;

  @ApiPropertyOptional({
    description: 'Scheduled follow-up revisit date (YYYY-MM-DD)',
    example: '2026-10-22',
  })
  @IsOptional()
  @IsString()
  revisitDate?: string;

  @ApiPropertyOptional({
    description: 'Array of prescribed medications',
    type: [PrescriptionItemDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items?: PrescriptionItemDto[];
}
