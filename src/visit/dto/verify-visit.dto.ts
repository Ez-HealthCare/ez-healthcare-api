import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class VerifyVisitDto {
  @ApiProperty({
    description: 'Flag indicating whether National ID physically matches bearer',
    example: true,
  })
  @IsNotEmpty()
  @IsBoolean()
  nationalIdVerified: boolean;

  @ApiPropertyOptional({
    description: 'Health Insurance Card Number (BHYT)',
    example: 'DN4791234567890',
  })
  @IsOptional()
  @IsString()
  insuranceCardNumber?: string;
}

export class RejectVerificationDto {
  @ApiProperty({
    description: 'Specific reason for rejecting reception verification audit',
    example: 'National ID photo does not match bearer.',
  })
  @IsNotEmpty()
  @IsString()
  reason: string;
}
