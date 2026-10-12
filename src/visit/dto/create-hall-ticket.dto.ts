import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateHallTicketDto {
  @ApiProperty({ description: 'Full name of the patient', example: 'Alice Brown' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Existing registered patient UUID', example: 'patient-uuid' })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiPropertyOptional({ description: 'National Citizen ID (CCCD)', example: '079123456789' })
  @IsOptional()
  @IsString()
  nationalId?: string;

  @ApiPropertyOptional({
    description: 'Health Insurance Card Number (BHYT)',
    example: 'DN4791234567890',
  })
  @IsOptional()
  @IsString()
  insuranceCardNumber?: string;

  @ApiPropertyOptional({
    description: 'Biological gender (MALE, FEMALE, OTHER)',
    example: 'FEMALE',
  })
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiPropertyOptional({ description: 'Date of birth (YYYY-MM-DD)', example: '1990-05-15' })
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @ApiPropertyOptional({
    description: 'Documented patient drug allergies',
    example: ['Penicillin'],
  })
  @IsOptional()
  @IsArray()
  allergies?: string[];

  @ApiPropertyOptional({
    description: 'Primary self-reported chief complaint',
    example: 'Headache and mild fever',
  })
  @IsOptional()
  @IsString()
  chiefComplaint?: string;

  @ApiPropertyOptional({ description: 'Time of symptom onset', example: '2 days ago' })
  @IsOptional()
  @IsString()
  symptomOnset?: string;

  @ApiPropertyOptional({ description: 'Duration of symptoms', example: '48 hours' })
  @IsOptional()
  @IsString()
  symptomDuration?: string;

  @ApiPropertyOptional({
    description: 'Subjective severity (MILD, MODERATE, SEVERE)',
    example: 'MILD',
  })
  @IsOptional()
  @IsString()
  symptomSeverity?: string;
}
