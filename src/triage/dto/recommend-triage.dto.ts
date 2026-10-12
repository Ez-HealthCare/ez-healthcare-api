import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';

export class RecommendTriageDto {
  @ApiPropertyOptional({
    description: 'List of observed symptom codes (e.g., SYM_FEVER_HIGH, SYM_ABDOMINAL_PAIN)',
    example: ['SYM_ABDOMINAL_PAIN'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  symptoms?: string[];

  @ApiPropertyOptional({
    description: 'Free text description of chief complaint',
    example: 'Persistent stomach pain for 2 days',
  })
  @IsOptional()
  @IsString()
  chiefComplaint?: string;

  @ApiPropertyOptional({
    description: 'Patient age in years (used for elderly priority check)',
    example: 45,
  })
  @IsOptional()
  @IsNumber()
  age?: number;
}
