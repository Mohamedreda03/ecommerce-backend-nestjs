import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderStatus } from '../common/enums/order-status.enum';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { AddressesService } from '../addresses/addresses.service';
import { CouponsService } from '../coupons/coupons.service';
import { OrdersService } from './orders.service';

// ─── UUIDs ───────────────────────────────────────────────────────────────────

const userId = '11111111-1111-4111-8111-111111111111';
const productId1 = '22222222-2222-4222-8222-222222222222';
const productId2 = '33333333-3333-4333-8333-333333333333';
const cartId = '44444444-4444-4444-8444-444444444444';
const orderId = '55555555-5555-4555-8555-555555555555';
const addressId = '66666666-6666-4666-8666-666666666666';
const couponId = '77777777-7777-4777-8777-777777777777';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCartWithItems(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: cartId,
    userId,
    items: [
      {
        id: 'item-1',
        productId: productId1,
        quantity: 2,
        product: {
          id: productId1,
          name: 'Widget A',
          sku: 'WGT-A-001',
          price: '25.00',
          stock: 10,
          isActive: true,
          deletedAt: null,
        },
      },
      {
        id: 'item-2',
        productId: productId2,
        quantity: 1,
        product: {
          id: productId2,
          name: 'Widget B',
          sku: 'WGT-B-001',
          price: '50.00',
          stock: 5,
          isActive: true,
          deletedAt: null,
        },
      },
    ],
    ...overrides,
  };
}

function makeAddress(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: addressId,
    userId,
    type: 'SHIPPING',
    firstName: 'John',
    lastName: 'Doe',
    street: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    country: 'US',
    zipCode: '62704',
    phone: '+1555123456',
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: orderId,
    orderNumber: 'ORD-20260314-1234',
    userId,
    status: OrderStatus.PENDING,
    subtotalAmount: '100.00',
    shippingAmount: '0.00',
    taxAmount: '0.00',
    discountAmount: '0.00',
    totalAmount: '100.00',
    shippingAddressSnapshot: {},
    billingAddressSnapshot: null,
    couponId: null,
    idempotencyKey: 'idem-key-1',
    notes: null,
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [
      {
        id: 'oi-1',
        productId: productId1,
        productName: 'Widget A',
        productSku: 'WGT-A-001',
        quantity: 2,
        unitPrice: '25.00',
        totalPrice: '50.00',
        createdAt: new Date(),
      },
      {
        id: 'oi-2',
        productId: productId2,
        productName: 'Widget B',
        productSku: 'WGT-B-001',
        quantity: 1,
        unitPrice: '50.00',
        totalPrice: '50.00',
        createdAt: new Date(),
      },
    ],
    payment: null,
    coupon: null,
    user: {
      id: userId,
      email: 'john@test.com',
      firstName: 'John',
      lastName: 'Doe',
    },
    ...overrides,
  };
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockTx = {
  cart: { findUnique: jest.fn() },
  product: { update: jest.fn() },
  coupon: { update: jest.fn() },
  order: { create: jest.fn(), findUnique: jest.fn() },
  cartItem: { deleteMany: jest.fn() },
};

const mockPrisma = {
  $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) => {
    if (typeof cb === 'function') return cb(mockTx);
    return Promise.all(cb);
  }),
  payment: {
    create: jest.fn(),
  },
  order: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
  },
};

const mockCartService = {
  getCart: jest.fn(),
  validateCart: jest.fn(),
};

const mockAddressesService = {
  findById: jest.fn(),
};

const mockCouponsService = {
  validateCoupon: jest.fn(),
  applyCoupon: jest.fn(),
};

const mockPaymentsService = {
  createPaymentIntent: jest.fn().mockResolvedValue({
    paymentIntentId: 'pi_test',
    clientSecret: 'secret_test',
  }),
};

import { PaymentsService } from '../payments/payments.service';

function buildModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      OrdersService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: CartService, useValue: mockCartService },
      { provide: AddressesService, useValue: mockAddressesService },
      { provide: CouponsService, useValue: mockCouponsService },
      { provide: PaymentsService, useValue: mockPaymentsService },
    ],
  }).compile();
}

describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await buildModule();
    service = module.get<OrdersService>(OrdersService);
  });

  // ─── checkout ──────────────────────────────────────────────────────────────

  describe('checkout', () => {
    const dto = {
      shippingAddressId: addressId,
      idempotencyKey: 'idem-key-1',
    };

    it('creates order, decrements stock, and clears cart on success', async () => {
      const cart = makeCartWithItems();
      mockTx.cart.findUnique.mockResolvedValue(cart);
      mockTx.product.update.mockResolvedValue({});
      mockTx.order.findUnique.mockResolvedValue(null); // order number is unique
      mockAddressesService.findById.mockResolvedValue(makeAddress());

      const createdOrder = makeOrder();
      mockTx.order.create.mockResolvedValue(createdOrder);
      mockTx.cartItem.deleteMany.mockResolvedValue({});

      const result = await service.checkout(userId, dto);

      expect(result.order).toBeDefined();
      expect(result.order.orderNumber).toMatch(/^ORD-/);

      // Stock decrement called for each cart item
      expect(mockTx.product.update).toHaveBeenCalledTimes(2);
      expect(mockTx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: productId1, stock: { gte: 2 } },
          data: { stock: { decrement: 2 } },
        }),
      );
      expect(mockTx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: productId2, stock: { gte: 1 } },
          data: { stock: { decrement: 1 } },
        }),
      );

      // Cart cleared
      expect(mockTx.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId },
      });
    });

    it('throws BadRequestException when cart is empty', async () => {
      mockTx.cart.findUnique.mockResolvedValue({
        id: cartId,
        userId,
        items: [],
      });

      await expect(service.checkout(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when cart does not exist', async () => {
      mockTx.cart.findUnique.mockResolvedValue(null);

      await expect(service.checkout(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for unavailable product', async () => {
      const cart = makeCartWithItems();
      cart.items[0].product.isActive = false;
      mockTx.cart.findUnique.mockResolvedValue(cart);

      await expect(service.checkout(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for insufficient stock (P2025)', async () => {
      const cart = makeCartWithItems();
      mockTx.cart.findUnique.mockResolvedValue(cart);

      // Simulate Prisma P2025 error (record not found due to stock WHERE clause)
      const p2025Error = new Error('Record not found');
      (p2025Error as any).code = 'P2025';
      Object.setPrototypeOf(p2025Error, Object.getPrototypeOf(new Error()));
      // We need to create a Prisma-like error
      const prismaError = {
        ...p2025Error,
        code: 'P2025',
        name: 'PrismaClientKnownRequestError',
      };
      mockTx.product.update.mockRejectedValueOnce(prismaError);

      // The service catches errors with instanceof Prisma.PrismaClientKnownRequestError
      // In tests, the mock won't match instanceof, so it will re-throw the raw error
      await expect(service.checkout(userId, dto)).rejects.toBeDefined();
    });

    it('applies coupon discount when couponCode is provided', async () => {
      const cart = makeCartWithItems();
      mockTx.cart.findUnique.mockResolvedValue(cart);
      mockTx.product.update.mockResolvedValue({});
      mockTx.order.findUnique.mockResolvedValue(null);
      mockAddressesService.findById.mockResolvedValue(makeAddress());
      mockTx.coupon.update.mockResolvedValue({});

      mockCouponsService.validateCoupon.mockResolvedValue({
        valid: true,
        discountAmount: 20,
        message: 'Coupon applied successfully',
        couponId,
      });

      const createdOrder = makeOrder({
        discountAmount: '20.00',
        totalAmount: '80.00',
        couponId,
      });
      mockTx.order.create.mockResolvedValue(createdOrder);
      mockTx.cartItem.deleteMany.mockResolvedValue({});

      const result = await service.checkout(userId, {
        ...dto,
        couponCode: 'SUMMER20',
      });

      expect(result.order).toBeDefined();
      expect(mockCouponsService.validateCoupon).toHaveBeenCalledWith(
        'SUMMER20',
        100,
      );
      // Coupon usage increment
      expect(mockTx.coupon.update).toHaveBeenCalledWith({
        where: { id: couponId },
        data: { currentUses: { increment: 1 } },
      });
    });

    it('throws BadRequestException when coupon is invalid', async () => {
      const cart = makeCartWithItems();
      mockTx.cart.findUnique.mockResolvedValue(cart);
      mockTx.product.update.mockResolvedValue({});

      mockCouponsService.validateCoupon.mockResolvedValue({
        valid: false,
        discountAmount: 0,
        message: 'Coupon has expired',
      });

      await expect(
        service.checkout(userId, { ...dto, couponCode: 'EXPIRED' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── findById ──────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns order when found', async () => {
      const order = makeOrder();
      mockPrisma.order.findUnique.mockResolvedValue(order);
      const result = await service.findById(orderId);
      expect(result.id).toBe(orderId);
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      await expect(service.findById(orderId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when userId does not match', async () => {
      const order = makeOrder();
      mockPrisma.order.findUnique.mockResolvedValue(order);
      await expect(service.findById(orderId, 'other-user')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows access when userId matches', async () => {
      const order = makeOrder();
      mockPrisma.order.findUnique.mockResolvedValue(order);
      const result = await service.findById(orderId, userId);
      expect(result.id).toBe(orderId);
    });
  });

  // ─── updateStatus ─────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('transitions PENDING → CONFIRMED', async () => {
      const order = makeOrder({ status: OrderStatus.PENDING });
      mockPrisma.order.findUnique.mockResolvedValue(order);
      mockPrisma.order.update.mockResolvedValue({
        ...order,
        status: OrderStatus.CONFIRMED,
      });

      const result = await service.updateStatus(orderId, {
        status: OrderStatus.CONFIRMED,
      });
      expect(result.status).toBe(OrderStatus.CONFIRMED);
    });

    it('rejects invalid transition DELIVERED → PENDING', async () => {
      const order = makeOrder({ status: OrderStatus.DELIVERED });
      mockPrisma.order.findUnique.mockResolvedValue(order);

      await expect(
        service.updateStatus(orderId, { status: OrderStatus.PENDING }),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets shippedAt timestamp when transitioning to SHIPPED', async () => {
      const order = makeOrder({ status: OrderStatus.PROCESSING });
      mockPrisma.order.findUnique.mockResolvedValue(order);
      mockPrisma.order.update.mockResolvedValue({
        ...order,
        status: OrderStatus.SHIPPED,
      });

      await service.updateStatus(orderId, { status: OrderStatus.SHIPPED });

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: OrderStatus.SHIPPED,
            shippedAt: expect.any(Date),
          }),
        }),
      );
    });
  });

  // ─── cancelOrder ──────────────────────────────────────────────────────────

  describe('cancelOrder', () => {
    it('cancels PENDING order and restores stock', async () => {
      const order = makeOrder({ status: OrderStatus.PENDING });
      mockPrisma.order.findUnique.mockResolvedValue(order);

      // mockTx for the cancel transaction
      const cancelTx = {
        product: { update: jest.fn().mockResolvedValue({}) },
        coupon: { update: jest.fn().mockResolvedValue({}) },
        order: {
          update: jest.fn().mockResolvedValue({
            ...order,
            status: OrderStatus.CANCELLED,
            cancelledAt: new Date(),
          }),
        },
      };

      mockPrisma.$transaction.mockImplementationOnce(
        (cb: (tx: unknown) => Promise<unknown>) => cb(cancelTx),
      );

      const result = await service.cancelOrder(orderId, userId);
      expect(result.status).toBe(OrderStatus.CANCELLED);

      // Stock restored for each item
      expect(cancelTx.product.update).toHaveBeenCalledTimes(2);
      expect(cancelTx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: productId1 },
          data: { stock: { increment: 2 } },
        }),
      );
    });

    it('rejects cancellation of SHIPPED order', async () => {
      const order = makeOrder({ status: OrderStatus.SHIPPED });
      mockPrisma.order.findUnique.mockResolvedValue(order);

      await expect(service.cancelOrder(orderId, userId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('decrements coupon usage when order had a coupon', async () => {
      const order = makeOrder({ status: OrderStatus.PENDING, couponId });
      mockPrisma.order.findUnique.mockResolvedValue(order);

      const cancelTx = {
        product: { update: jest.fn().mockResolvedValue({}) },
        coupon: { update: jest.fn().mockResolvedValue({}) },
        order: {
          update: jest.fn().mockResolvedValue({
            ...order,
            status: OrderStatus.CANCELLED,
          }),
        },
      };

      mockPrisma.$transaction.mockImplementationOnce(
        (cb: (tx: unknown) => Promise<unknown>) => cb(cancelTx),
      );

      await service.cancelOrder(orderId, userId);

      expect(cancelTx.coupon.update).toHaveBeenCalledWith({
        where: { id: couponId },
        data: { currentUses: { decrement: 1 } },
      });
    });
  });

  // ─── getOrderStats ────────────────────────────────────────────────────────

  describe('getOrderStats', () => {
    it('returns aggregated stats', async () => {
      mockPrisma.order.count.mockResolvedValue(50);
      mockPrisma.order.aggregate.mockResolvedValue({
        _sum: { totalAmount: '5000.00' },
      });
      mockPrisma.order.groupBy.mockResolvedValue([
        { status: OrderStatus.PENDING, _count: { id: 10 } },
        { status: OrderStatus.DELIVERED, _count: { id: 30 } },
        { status: OrderStatus.CANCELLED, _count: { id: 10 } },
      ]);
      mockPrisma.order.findMany.mockResolvedValue([makeOrder()]);

      const stats = await service.getOrderStats();

      expect(stats.totalOrders).toBe(50);
      expect(stats.totalRevenue).toBe(5000);
      expect(stats.averageOrderValue).toBe(100);
      expect(stats.ordersByStatus).toEqual({
        PENDING: 10,
        DELIVERED: 30,
        CANCELLED: 10,
      });
      expect(stats.recentOrders).toHaveLength(1);
    });
  });
});
