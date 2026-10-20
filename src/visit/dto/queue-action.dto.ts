import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { QueueTicketKind } from '../enums/queue-ticket.enum';

export class ReissueTicketDto {
  @ApiProperty({ enum: QueueTicketKind })
  @IsEnum(QueueTicketKind)
  kind: QueueTicketKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class RequeueVisitDto {
  @ApiProperty({ description: 'Reason for returning an absent patient to the queue' })
  @IsNotEmpty()
  @IsString()
  reason: string;
}
