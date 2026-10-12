import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class RecordVitalsDto {
  @ApiProperty({ description: 'Systolic blood pressure in mmHg', example: 120 })
  @IsNotEmpty()
  @IsNumber()
  @Min(40)
  @Max(260)
  bloodPressureSystolic: number;

  @ApiProperty({ description: 'Diastolic blood pressure in mmHg', example: 80 })
  @IsNotEmpty()
  @IsNumber()
  @Min(30)
  @Max(160)
  bloodPressureDiastolic: number;

  @ApiProperty({ description: 'Heart rate in beats per minute', example: 75 })
  @IsNotEmpty()
  @IsNumber()
  @Min(30)
  @Max(240)
  heartRate: number;

  @ApiProperty({ description: 'Body temperature in degrees Celsius', example: 37.0 })
  @IsNotEmpty()
  @IsNumber()
  @Min(34.0)
  @Max(43.0)
  temperature: number;

  @ApiProperty({ description: 'Blood oxygen saturation percentage (SpO2)', example: 98.0 })
  @IsNotEmpty()
  @IsNumber()
  @Min(50.0)
  @Max(100.0)
  spo2: number;

  @ApiProperty({ description: 'Respiratory rate in breaths per minute', example: 16 })
  @IsNotEmpty()
  @IsNumber()
  @Min(8)
  @Max(60)
  respiratoryRate: number;

  @ApiPropertyOptional({ description: 'Patient weight in kilograms', example: 65.5 })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(500)
  weightKg?: number;

  @ApiPropertyOptional({ description: 'Patient height in centimeters', example: 170 })
  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(280)
  heightCm?: number;

  @ApiPropertyOptional({
    description: 'Flag marking severe vital instability / emergency red flag',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isRedFlag?: boolean;

  @ApiPropertyOptional({
    description: 'Clinical explanation for red flag emergency dispatch',
    example: 'Severe hypoxia with SpO2 < 90%',
  })
  @IsOptional()
  @IsString()
  redFlagReason?: string;

  @ApiPropertyOptional({
    description: 'Additional nurse clinical notes',
    example: 'Patient alert, resting comfortably.',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
