import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

export class SubmitResultDto {
  @ApiPropertyOptional({
    description: 'Laboratory quantitative values as key-value pairs',
    example: { WBC: '8.5', RBC: '4.8', Platelets: '250', Potassium: '4.2' },
  })
  @IsOptional()
  @IsObject()
  quantitativeValues?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Diagnostic narrative findings or impression',
    example: 'All hematological indices within normal reference range.',
  })
  @IsOptional()
  @IsString()
  findings?: string;

  @ApiPropertyOptional({
    description: 'Flag indicating a life-threatening critical panic value',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isPanicValue?: boolean;

  @ApiPropertyOptional({
    description: 'Details and clinical protocol instructions for panic value',
    example:
      'CRITICAL PANIC VALUE: Severe hyperkalemia (7.1 mmol/L) with imminent cardiac arrest risk!',
  })
  @IsOptional()
  @IsString()
  panicAlertDetails?: string;

  @ApiPropertyOptional({
    description: 'PACS DICOM or JPEG image URLs',
    example: ['https://pacs.ezhealthcare.local/studies/104/img01.jpg'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dicomImageUrls?: string[];
}
