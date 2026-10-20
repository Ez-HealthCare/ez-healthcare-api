import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateHallTicketDto {
  @ApiPropertyOptional({
    description:
      'Optional client request reference; the Idempotency-Key header remains authoritative',
  })
  @IsOptional()
  @IsString()
  requestReference?: string;
}
