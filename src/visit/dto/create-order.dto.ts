import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({
    description: 'Array of diagnostic station department codes ordered by doctor',
    example: ['P.201', 'P.104', 'P.203'],
    type: [String],
  })
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  orders: string[];

  @ApiPropertyOptional({
    description: 'Working provisional diagnosis',
    example: 'Acute abdominal pain under investigation',
  })
  @IsOptional()
  @IsString()
  workingDiagnosis?: string;

  @ApiPropertyOptional({
    description: 'Flag marking suspected pregnancy (triggers radiation safety check for X-ray)',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  pregnancySuspected?: boolean;

  @ApiPropertyOptional({
    description: 'Identified symptom codes',
    example: ['SYM_ABDOMINAL_PAIN'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  symptoms?: string[];

  @ApiPropertyOptional({
    description: 'Doctor specific clinical instructions for technicians',
    example: 'Focus on gallbladder and appendix.',
  })
  @IsOptional()
  @IsString()
  doctorNotes?: string;
}
