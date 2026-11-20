import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateSystemConfigDto {
  @ApiProperty({ description: 'Configuration value in text or stringified JSON format' })
  @IsNotEmpty()
  @IsString()
  configValue: string;

  @ApiPropertyOptional({ description: 'Explanation or business context for this configuration' })
  @IsOptional()
  @IsString()
  description?: string;
}
