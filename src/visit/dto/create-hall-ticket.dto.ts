import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateHallTicketDto {
  @ApiPropertyOptional({
    description:
      'Optional client request reference; the Idempotency-Key header remains authoritative',
  })
  @IsOptional()
  @IsString()
  requestReference?: string;
}

export class CreateWalkInTicketDto {
  @ApiProperty({ description: 'Existing patient account ID for a walk-in visit' })
  @IsUUID()
  @IsNotEmpty()
  patientId: string;
}
