import { ApiProperty } from '@nestjs/swagger';
import { IsDecimal, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ValidateCouponDto {
  @ApiProperty({ example: 'SUMMER20', description: 'Coupon code to validate' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code: string;

  @ApiProperty({ example: '150.00', description: 'Current order subtotal (before discount)' })
  @IsDecimal({ decimal_digits: '0,4' })
  orderSubtotal: string;
}
