import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ description: 'Shipping address ID' })
  @IsUUID()
  @IsNotEmpty()
  shippingAddressId: string;

  @ApiPropertyOptional({ description: 'Billing address ID' })
  @IsOptional()
  @IsUUID()
  billingAddressId?: string;

  @ApiPropertyOptional({ description: 'Coupon code to apply' })
  @IsOptional()
  @IsString()
  couponCode?: string;

  @ApiPropertyOptional({ description: 'Order notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ description: 'Idempotency key to prevent duplicate orders' })
  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}
