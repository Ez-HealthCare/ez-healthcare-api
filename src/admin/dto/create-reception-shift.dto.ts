import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { ShiftType } from '../../department/enums/shift-type.enum';

export class CreateReceptionShiftDto {
  @ApiProperty({ description: 'Date of shift (YYYY-MM-DD)', example: '2026-11-20' })
  @IsNotEmpty()
  @IsDateString()
  businessDate: string;

  @ApiProperty({
    enum: ShiftType,
    description: 'Shift slot (MORNING / AFTERNOON)',
    example: ShiftType.MORNING,
  })
  @IsNotEmpty()
  @IsEnum(ShiftType)
  shiftType: ShiftType;

  @ApiProperty({ description: 'Desk 2-digit code (e.g. 01, 02)', example: '01' })
  @IsNotEmpty()
  @IsString()
  @Length(1, 2)
  deskCode: string;

  @ApiProperty({ description: 'UUID of receptionist staff assigned to desk' })
  @IsNotEmpty()
  @IsUUID()
  receptionistId: string;

  @ApiPropertyOptional({ description: 'Whether desk is accepting tickets', default: true })
  @IsOptional()
  @IsBoolean()
  acceptingCalls?: boolean = true;
}
