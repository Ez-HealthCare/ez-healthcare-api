import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class AdminReportsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter visits starting from (YYYY-MM-DD)',
    example: '2026-11-01',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Filter visits up to (YYYY-MM-DD)', example: '2026-11-30' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Filter by specific department UUID' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
