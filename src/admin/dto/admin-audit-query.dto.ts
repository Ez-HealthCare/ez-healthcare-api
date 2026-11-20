import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class AdminAuditQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by action code (e.g. CREATE_STAFF_USER, RESET_PASSWORD)',
  })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: 'Filter by actor role (e.g. ADMIN, DOCTOR)' })
  @IsOptional()
  @IsString()
  actorRole?: string;

  @ApiPropertyOptional({ description: 'Search term for target entity or metadata' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Page number (default 1)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Page limit (default 20, max 100)', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
