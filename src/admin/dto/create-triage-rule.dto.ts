import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateTriageRuleDto {
  @ApiProperty({
    description: 'Unique symptom code (e.g. SYM_CHEST_PAIN)',
    example: 'SYM_CHEST_PAIN',
  })
  @IsNotEmpty()
  @IsString()
  symptomCode: string;

  @ApiProperty({ description: 'Human readable symptom name', example: 'Đau thắt ngực cấp tính' })
  @IsNotEmpty()
  @IsString()
  symptomName: string;

  @ApiProperty({ description: 'Target department UUID' })
  @IsNotEmpty()
  @IsUUID()
  targetDepartmentId: string;

  @ApiPropertyOptional({
    description: 'Flag whether this symptom requires STAT emergency',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isRedFlag?: boolean = false;

  @ApiPropertyOptional({ description: 'Contraindication symptom tags', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contraindicationTags?: string[];

  @ApiPropertyOptional({
    description: 'Priority weight for triage evaluation (higher evaluated first)',
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  priorityWeight?: number = 1;
}
