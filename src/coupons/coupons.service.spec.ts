import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DiscountType } from '../common/enums/discount-type.enum';
import { PrismaService } from '../prisma/prisma.service';
import { CouponsService } from './coupons.service';

// ─── UUIDs ───────────────────────────────────────────────────────────────────
const couponId = '11111111-1111-4111-8111-111111111111';

// ─── Base coupon fixture builder ──────────────────────────────────────────────
function makeCoupon(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: couponId,
    code: 'SUMMER20',
    description: '20% off',
    discountType: DiscountType.PERCENTAGE,
    discountValue: '20.00',
    minOrderAmount: null,
    maxDiscountAmount: null,
    maxUses: null,
    currentUses: 0,
    isActive: true,
    startsAt: null,
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── Mock Prisma ─────────────────────────────────────────────────────────────
const mockPrisma = {
  coupon: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
};

function buildModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      CouponsService,
      { provide: PrismaService, useValue: mockPrisma },
    ],
  }).compile();
}

describe('CouponsService', () => {
  let service: CouponsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await buildModule();
    service = module.get<CouponsService>(CouponsService);
  });

  // ─── findById ─────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns coupon when found', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(makeCoupon());
      const result = await service.findById(couponId);
      expect(result.id).toBe(couponId);
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(null);
      await expect(service.findById(couponId)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('auto-uppercases the coupon code', async () => {
      const coupon = makeCoupon({ code: 'SUMMER20' });
      mockPrisma.coupon.create.mockResolvedValue(coupon);

      await service.create({
        code: 'summer20',
        discountType: DiscountType.PERCENTAGE,
        discountValue: '20.00',
      });

      expect(mockPrisma.coupon.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ code: 'SUMMER20' }) }),
      );
    });

    it('sets isActive to true by default', async () => {
      mockPrisma.coupon.create.mockResolvedValue(makeCoupon());
      await service.create({
        code: 'TEST',
        discountType: DiscountType.FIXED_AMOUNT,
        discountValue: '10.00',
      });

      expect(mockPrisma.coupon.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }),
      );
    });
  });

  // ─── delete ───────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes coupon when currentUses === 0', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(makeCoupon({ currentUses: 0 }));
      mockPrisma.coupon.delete.mockResolvedValue(makeCoupon());

      const result = await service.delete(couponId);
      expect(result).toEqual({ message: 'Coupon deleted successfully' });
      expect(mockPrisma.coupon.delete).toHaveBeenCalledWith({ where: { id: couponId } });
    });

    it('throws BadRequestException when coupon has been used', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(makeCoupon({ currentUses: 5 }));
      await expect(service.delete(couponId)).rejects.toThrow(BadRequestException);
    });
  });

  // ─── validateCoupon ───────────────────────────────────────────────────────

  describe('validateCoupon', () => {
    it('returns valid=false when coupon does not exist', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(null);
      const result = await service.validateCoupon('NOTEXIST', 100);
      expect(result.valid).toBe(false);
      expect(result.discountAmount).toBe(0);
    });

    it('returns valid=false when coupon is inactive', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(makeCoupon({ isActive: false }));
      const result = await service.validateCoupon('SUMMER20', 100);
      expect(result.valid).toBe(false);
    });

    it('returns valid=false when coupon has expired', async () => {
      const past = new Date(Date.now() - 86400_000); // yesterday
      mockPrisma.coupon.findUnique.mockResolvedValue(makeCoupon({ expiresAt: past }));
      const result = await service.validateCoupon('SUMMER20', 100);
      expect(result.valid).toBe(false);
      expect(result.message).toMatch(/expired/i);
    });

    it('returns valid=false when coupon has not started yet', async () => {
      const future = new Date(Date.now() + 86400_000); // tomorrow
      mockPrisma.coupon.findUnique.mockResolvedValue(makeCoupon({ startsAt: future }));
      const result = await service.validateCoupon('SUMMER20', 100);
      expect(result.valid).toBe(false);
      expect(result.message).toMatch(/not yet active/i);
    });

    it('returns valid=false when max uses reached', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(
        makeCoupon({ maxUses: 10, currentUses: 10 }),
      );
      const result = await service.validateCoupon('SUMMER20', 100);
      expect(result.valid).toBe(false);
      expect(result.message).toMatch(/usage limit/i);
    });

    it('returns valid=false when order subtotal is below minimum', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(
        makeCoupon({ minOrderAmount: '200.00' }),
      );
      const result = await service.validateCoupon('SUMMER20', 150);
      expect(result.valid).toBe(false);
      expect(result.message).toMatch(/minimum order/i);
    });

    it('correctly calculates PERCENTAGE discount', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(
        makeCoupon({ discountType: DiscountType.PERCENTAGE, discountValue: '20.00' }),
      );
      const result = await service.validateCoupon('SUMMER20', 100);
      expect(result.valid).toBe(true);
      expect(result.discountAmount).toBe(20); // 20% of 100
    });

    it('caps PERCENTAGE discount at maxDiscountAmount', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(
        makeCoupon({
          discountType: DiscountType.PERCENTAGE,
          discountValue: '50.00',
          maxDiscountAmount: '30.00',
        }),
      );
      const result = await service.validateCoupon('SUMMER20', 200);
      expect(result.valid).toBe(true);
      expect(result.discountAmount).toBe(30); // 50% of 200 = 100, capped at 30
    });

    it('correctly calculates FIXED_AMOUNT discount', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(
        makeCoupon({ discountType: DiscountType.FIXED_AMOUNT, discountValue: '25.00' }),
      );
      const result = await service.validateCoupon('FLAT25', 100);
      expect(result.valid).toBe(true);
      expect(result.discountAmount).toBe(25);
    });

    it('caps FIXED_AMOUNT discount at order subtotal', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(
        makeCoupon({ discountType: DiscountType.FIXED_AMOUNT, discountValue: '200.00' }),
      );
      const result = await service.validateCoupon('FLAT200', 50);
      expect(result.valid).toBe(true);
      expect(result.discountAmount).toBe(50); // capped at subtotal
    });

    it('returns couponId on successful validation', async () => {
      mockPrisma.coupon.findUnique.mockResolvedValue(makeCoupon());
      const result = await service.validateCoupon('SUMMER20', 100);
      expect(result.couponId).toBe(couponId);
    });
  });

  // ─── applyCoupon ──────────────────────────────────────────────────────────

  describe('applyCoupon', () => {
    it('increments currentUses by 1', async () => {
      mockPrisma.coupon.update.mockResolvedValue(makeCoupon({ currentUses: 1 }));
      await service.applyCoupon(couponId);
      expect(mockPrisma.coupon.update).toHaveBeenCalledWith({
        where: { id: couponId },
        data: { currentUses: { increment: 1 } },
      });
    });
  });
});
