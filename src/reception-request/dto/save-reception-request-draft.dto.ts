import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';

/** Patient-editable fields. A draft is intentionally allowed to be incomplete. */
export class SaveReceptionRequestDraftDto {
  @ApiPropertyOptional({ example: 'Ho va sot nhe tu hai ngay nay.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  chiefComplaint?: string;

  @ApiPropertyOptional({ example: ['COUGH', 'FEVER'], type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  symptomCodes?: string[];

  @ApiPropertyOptional({ example: '2_DAYS_AGO' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  symptomOnset?: string;

  @ApiPropertyOptional({ example: '2 ngày' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  symptomDuration?: string;

  @ApiPropertyOptional({ example: 'MODERATE' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  symptomSeverity?: string;

  @ApiPropertyOptional({ example: 'Tôi muốn được tư vấn khám nội tổng quát.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  patientNote?: string;

  @ApiPropertyOptional({ example: 'Khám nội tổng quát' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  requestedServiceNote?: string;
}
