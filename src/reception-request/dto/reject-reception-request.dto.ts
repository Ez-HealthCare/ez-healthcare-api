import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectReceptionRequestDto {
  @ApiProperty({ description: 'Administrative reason the request cannot be verified' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
