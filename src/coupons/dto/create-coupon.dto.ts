import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDecimal,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DiscountType } from '../../common/enums/discount-type.enum';

export class CreateCouponDto {
  @ApiProperty({ example: 'SUMMER20', description: 'Coupon code (auto-uppercased)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code: string;

  @ApiPropertyOptional({ example: '20% off summer sale' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ enum: DiscountType, example: DiscountType.PERCENTAGE })
  @IsEnum(DiscountType)
  discountType: DiscountType;

  @ApiProperty({ example: '20.00', description: 'Discount value (percentage or fixed amount)' })
  @IsDecimal({ decimal_digits: '0,4' })
  discountValue: string;

  @ApiPropertyOptional({ example: '50.00', description: 'Minimum order subtotal to use coupon' })
  @IsOptional()
  @IsDecimal({ decimal_digits: '0,4' })
  minOrderAmount?: string;

  @ApiPropertyOptional({ example: '100.00', description: 'Maximum discount cap (for PERCENTAGE type)' })
  @IsOptional()
  @IsDecimal({ decimal_digits: '0,4' })
  maxDiscountAmount?: string;

  @ApiPropertyOptional({ example: 100, description: 'Max total redemptions (null = unlimited)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUses?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: '2026-06-01T00:00:00.000Z' })
  @IsOptional()
  @IsString()
  startsAt?: string;

  @ApiPropertyOptional({ example: '2026-08-31T23:59:59.000Z' })
  @IsOptional()
  @IsString()
  expiresAt?: string;
}
