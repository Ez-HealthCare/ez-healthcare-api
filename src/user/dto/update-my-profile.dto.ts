import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateMyProfileDto {
  @ApiProperty({ example: 'Nguyen Van An' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: '1998-05-20' })
  @IsDateString()
  dateOfBirth: string;

  @ApiProperty({ example: 'MALE' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  gender: string;

  @ApiProperty({ example: '0901234567' })
  @IsString()
  @Matches(/^[0-9+()\-\s]{8,30}$/)
  phone: string;

  @ApiProperty({ example: '079123456789' })
  @IsString()
  @Matches(/^\d{9,20}$/)
  nationalId: string;

  @ApiProperty({ type: [String], example: [] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  allergies: string[];

  @ApiPropertyOptional({ example: 'DN4012345678901' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  insuranceCardNumber?: string;
}
