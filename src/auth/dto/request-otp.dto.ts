import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export class RequestOtpDto {
  @ApiProperty({
    example: 'patient.david@example.com',
    description: 'Patient email address for OTP delivery',
  })
  @IsEmail({}, { message: 'Invalid email address format' })
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email: string;
}
