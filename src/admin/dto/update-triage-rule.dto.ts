import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class UpdateTriageRuleDto {
  @ApiPropertyOptional({ description: 'Human readable symptom name' })
  @IsOptional()
  @IsString()
  symptomName?: string;

  @ApiPropertyOptional({ description: 'Target department UUID' })
  @IsOptional()
  @IsUUID()
  targetDepartmentId?: string;

  @ApiPropertyOptional({ description: 'Flag whether this symptom requires STAT emergency' })
  @IsOptional()
  @IsBoolean()
  isRedFlag?: boolean;

  @ApiPropertyOptional({ description: 'Contraindication symptom tags', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contraindicationTags?: string[];

  @ApiPropertyOptional({
    description: 'Priority weight for triage evaluation (higher evaluated first)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  priorityWeight?: number;
}
