import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { DiscountType } from '../common/enums/discount-type.enum';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';

export interface CouponValidationResult {
  valid: boolean;
  discountAmount: number;
  message: string;
  couponId?: string;
}

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Admin: CRUD ─────────────────────────────────────────────────────────────

  async findAll(query: PaginationQueryDto): Promise<PaginatedResponseDto<unknown>> {
    const { page, limit, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.coupon.findMany({
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.coupon.count(),
    ]);

    return new PaginatedResponseDto(data, total, page, limit);
  }

  async findById(id: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) {
      throw new NotFoundException(`Coupon with ID "${id}" not found`);
    }
    return coupon;
  }

  async create(dto: CreateCouponDto) {
    return this.prisma.coupon.create({
      data: {
        ...dto,
        code: dto.code.toUpperCase(),
        isActive: dto.isActive ?? true,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
  }

  async update(id: string, dto: UpdateCouponDto) {
    await this.findById(id);

    return this.prisma.coupon.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.code && { code: dto.code.toUpperCase() }),
        ...(dto.startsAt !== undefined && { startsAt: dto.startsAt ? new Date(dto.startsAt) : null }),
        ...(dto.expiresAt !== undefined && { expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null }),
      },
    });
  }

  async delete(id: string) {
    const coupon = await this.findById(id);
    if (coupon.currentUses > 0) {
      throw new BadRequestException(
        `Cannot delete coupon "${coupon.code}" — it has already been used ${coupon.currentUses} time(s)`,
      );
    }
    await this.prisma.coupon.delete({ where: { id } });
    return { message: 'Coupon deleted successfully' };
  }

  // ─── Coupon validation logic ──────────────────────────────────────────────────

  async validateCoupon(
    code: string,
    orderSubtotal: number,
  ): Promise<CouponValidationResult> {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: code.toUpperCase() },
    });

    // 1. Exists and active
    if (!coupon || !coupon.isActive) {
      return { valid: false, discountAmount: 0, message: 'Coupon not found or inactive' };
    }

    const now = new Date();

    // 2. Not expired
    if (coupon.expiresAt && coupon.expiresAt < now) {
      return { valid: false, discountAmount: 0, message: 'Coupon has expired' };
    }

    // 3. Has started
    if (coupon.startsAt && coupon.startsAt > now) {
      return { valid: false, discountAmount: 0, message: 'Coupon is not yet active' };
    }

    // 4. Usage limit
    if (coupon.maxUses !== null && coupon.currentUses >= coupon.maxUses) {
      return { valid: false, discountAmount: 0, message: 'Coupon has reached its usage limit' };
    }

    // 5. Minimum order amount
    const minOrder = coupon.minOrderAmount ? Number(coupon.minOrderAmount) : null;
    if (minOrder !== null && orderSubtotal < minOrder) {
      return {
        valid: false,
        discountAmount: 0,
        message: `Minimum order amount of ${minOrder.toFixed(2)} required to use this coupon`,
      };
    }

    // 6. Calculate discount
    const discountValue = Number(coupon.discountValue);
    let discountAmount: number;

    if (coupon.discountType === DiscountType.PERCENTAGE) {
      discountAmount = (orderSubtotal * discountValue) / 100;
      // Cap at maxDiscountAmount if set
      if (coupon.maxDiscountAmount !== null) {
        const cap = Number(coupon.maxDiscountAmount);
        discountAmount = Math.min(discountAmount, cap);
      }
    } else {
      // FIXED_AMOUNT — cap at order subtotal so discount never exceeds order
      discountAmount = Math.min(discountValue, orderSubtotal);
    }

    discountAmount = Math.round(discountAmount * 100) / 100; // round to 2 decimals

    return {
      valid: true,
      discountAmount,
      message: 'Coupon applied successfully',
      couponId: coupon.id,
    };
  }

  /**
   * Atomically increments currentUses. MUST be called inside a Prisma transaction
   * (tx) during checkout — pass the tx client as `prismaClient`.
   */
  async applyCoupon(couponId: string, prismaClient: PrismaService = this.prisma) {
    return prismaClient.coupon.update({
      where: { id: couponId },
      data: { currentUses: { increment: 1 } },
    });
  }
}
