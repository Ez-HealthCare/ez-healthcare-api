import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CancelAppointmentDto {
  @ApiProperty({ description: 'Reason the appointment was cancelled' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
