import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { AddressesService } from '../addresses/addresses.service';
import { CouponsService } from '../coupons/coupons.service';
import { PaymentsService } from '../payments/payments.service';
import { OrderStatus } from '../common/enums/order-status.enum';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderQueryDto } from './dto/order-query.dto';

// ─── Valid status transitions ──────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [OrderStatus.REFUNDED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REFUNDED]: [],
};

// ─── Order include for detailed responses ──────────────────────────────────────

const ORDER_INCLUDE = {
  items: {
    select: {
      id: true,
      productId: true,
      productName: true,
      productSku: true,
      quantity: true,
      unitPrice: true,
      totalPrice: true,
      createdAt: true,
    },
  },
  payment: {
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      createdAt: true,
    },
  },
  coupon: {
    select: {
      id: true,
      code: true,
      discountType: true,
      discountValue: true,
    },
  },
} as const;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
    private readonly addressesService: AddressesService,
    private readonly couponsService: CouponsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  // ─── Checkout ──────────────────────────────────────────────────────────────────

  async checkout(userId: string, dto: CreateOrderDto) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        // 1. Validate cart
        const cart = await tx.cart.findUnique({
          where: { userId },
          select: {
            id: true,
            items: {
              select: {
                id: true,
                productId: true,
                quantity: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                    sku: true,
                    price: true,
                    stock: true,
                    isActive: true,
                    deletedAt: true,
                  },
                },
              },
            },
          },
        });

        if (!cart || cart.items.length === 0) {
          throw new BadRequestException('Cart is empty');
        }

        // Check all products are still active
        for (const item of cart.items) {
          if (!item.product.isActive || item.product.deletedAt) {
            throw new BadRequestException(
              `Product "${item.product.name}" is no longer available`,
            );
          }
        }

        // 2. Atomic stock decrement
        for (const item of cart.items) {
          try {
            await tx.product.update({
              where: {
                id: item.productId,
                stock: { gte: item.quantity },
              },
              data: { stock: { decrement: item.quantity } },
            });
          } catch (error) {
            // P2025: record not found (stock < quantity)
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === 'P2025'
            ) {
              throw new BadRequestException(
                `Insufficient stock for "${item.product.name}"`,
              );
            }
            throw error;
          }
        }

        // 3. Validate & apply coupon
        let discountAmount = 0;
        let couponId: string | null = null;

        const subtotalAmount = cart.items.reduce(
          (sum, item) => sum + Number(item.product.price) * item.quantity,
          0,
        );

        if (dto.couponCode) {
          const validation = await this.couponsService.validateCoupon(
            dto.couponCode,
            subtotalAmount,
          );

          if (!validation.valid) {
            throw new BadRequestException(validation.message);
          }

          discountAmount = validation.discountAmount;
          couponId = validation.couponId!;

          // Increment coupon usage inside the transaction
          await tx.coupon.update({
            where: { id: couponId },
            data: { currentUses: { increment: 1 } },
          });
        }

        // 4. Snapshot addresses
        const shippingAddress = await this.addressesService.findById(
          userId,
          dto.shippingAddressId,
        );
        const shippingAddressSnapshot = {
          firstName: shippingAddress.firstName,
          lastName: shippingAddress.lastName,
          street: shippingAddress.street,
          city: shippingAddress.city,
          state: shippingAddress.state,
          country: shippingAddress.country,
          zipCode: shippingAddress.zipCode,
          phone: shippingAddress.phone,
        };

        let billingAddressSnapshot: Prisma.InputJsonValue | null = null;
        if (dto.billingAddressId) {
          const billingAddress = await this.addressesService.findById(
            userId,
            dto.billingAddressId,
          );
          billingAddressSnapshot = {
            firstName: billingAddress.firstName,
            lastName: billingAddress.lastName,
            street: billingAddress.street,
            city: billingAddress.city,
            state: billingAddress.state,
            country: billingAddress.country,
            zipCode: billingAddress.zipCode,
            phone: billingAddress.phone,
          };
        }

        // 5. Calculate totals
        const shippingAmount = 0; // Phase 20 will implement shipping calculation
        const taxAmount = 0;
        const totalAmount =
          subtotalAmount - discountAmount + shippingAmount + taxAmount;

        // 6. Generate order number
        const orderNumber = await this.generateOrderNumber(tx);

        // 7. Create order with items
        const order = await tx.order.create({
          data: {
            orderNumber,
            userId,
            status: OrderStatus.PENDING,
            subtotalAmount,
            shippingAmount,
            taxAmount,
            discountAmount,
            totalAmount,
            shippingAddressSnapshot,
            billingAddressSnapshot: billingAddressSnapshot ?? undefined,
            couponId,
            idempotencyKey: dto.idempotencyKey,
            notes: dto.notes,
            items: {
              create: cart.items.map((item) => ({
                productId: item.productId,
                productName: item.product.name,
                productSku: item.product.sku,
                quantity: item.quantity,
                unitPrice: Number(item.product.price),
                totalPrice: Number(item.product.price) * item.quantity,
              })),
            },
          },
          include: ORDER_INCLUDE,
        });

        // 8. Clear cart
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

        return { order, totalAmount };
      },
      { timeout: 30000 },
    );

    // 9. Create Stripe PaymentIntent outside the transaction
    const { paymentIntentId, clientSecret } =
      await this.paymentsService.createPaymentIntent({
        id: result.order.id,
        orderNumber: result.order.orderNumber,
        userId,
        totalAmount: result.totalAmount,
      });

    // 10. Create Payment record outside the transaction
    await this.prisma.payment.create({
      data: {
        orderId: result.order.id,
        stripePaymentIntentId: paymentIntentId,
        amount: result.totalAmount,
        currency: 'usd',
        status: 'PENDING',
      },
    });

    return { order: result.order, clientSecret };
  }

  // ─── Order queries ─────────────────────────────────────────────────────────────

  async findAllByUser(
    userId: string,
    query: OrderQueryDto,
  ): Promise<PaginatedResponseDto<unknown>> {
    const { page, limit, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = {
      userId,
      ...this.buildDateFilter(query),
      ...(query.status && { status: query.status }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: ORDER_INCLUDE,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.order.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, limit);
  }

  async findAll(query: OrderQueryDto): Promise<PaginatedResponseDto<unknown>> {
    const { page, limit, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = {
      ...this.buildDateFilter(query),
      ...(query.status && { status: query.status }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: {
          ...ORDER_INCLUDE,
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.order.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, limit);
  }

  async findById(id: string, userId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        ...ORDER_INCLUDE,
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID "${id}" not found`);
    }

    // Ownership check for customers
    if (userId && order.userId !== userId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    return order;
  }

  // ─── Status management ─────────────────────────────────────────────────────────

  async updateStatus(id: string, dto: UpdateOrderStatusDto) {
    const order = await this.findById(id);

    const allowed = VALID_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from "${order.status}" to "${dto.status}"`,
      );
    }

    const timestampUpdates: Record<string, Date> = {};
    if (dto.status === OrderStatus.SHIPPED) timestampUpdates.shippedAt = new Date();
    if (dto.status === OrderStatus.DELIVERED) timestampUpdates.deliveredAt = new Date();
    if (dto.status === OrderStatus.CANCELLED) timestampUpdates.cancelledAt = new Date();

    return this.prisma.order.update({
      where: { id },
      data: {
        status: dto.status,
        ...timestampUpdates,
      },
      include: ORDER_INCLUDE,
    });
  }

  async cancelOrder(id: string, userId: string) {
    const order = await this.findById(id, userId);

    if (
      order.status !== OrderStatus.PENDING &&
      order.status !== OrderStatus.CONFIRMED
    ) {
      throw new BadRequestException(
        `Cannot cancel order with status "${order.status}". Only PENDING or CONFIRMED orders can be cancelled.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Restore stock
      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }

      // Decrement coupon usage
      if (order.couponId) {
        await tx.coupon.update({
          where: { id: order.couponId },
          data: { currentUses: { decrement: 1 } },
        });
      }

      // Update order status
      return tx.order.update({
        where: { id },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledAt: new Date(),
        },
        include: ORDER_INCLUDE,
      });
    });
  }

  // ─── Admin stats ───────────────────────────────────────────────────────────────

  async getOrderStats() {
    const [
      totalOrders,
      totalRevenue,
      ordersByStatus,
      recentOrders,
    ] = await Promise.all([
      this.prisma.order.count(),

      this.prisma.order.aggregate({
        _sum: { totalAmount: true },
        where: {
          status: {
            in: [
              OrderStatus.CONFIRMED,
              OrderStatus.PROCESSING,
              OrderStatus.SHIPPED,
              OrderStatus.DELIVERED,
            ],
          },
        },
      }),

      this.prisma.order.groupBy({
        by: ['status'],
        _count: { id: true },
      }),

      this.prisma.order.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
      }),
    ]);

    const statusCounts = ordersByStatus.reduce(
      (acc, item) => {
        acc[item.status] = item._count.id;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      totalOrders,
      totalRevenue: Number(totalRevenue._sum.totalAmount ?? 0),
      ordersByStatus: statusCounts,
      averageOrderValue:
        totalOrders > 0
          ? Number(totalRevenue._sum.totalAmount ?? 0) / totalOrders
          : 0,
      recentOrders,
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────────

  private async generateOrderNumber(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const maxAttempts = 10;

    for (let i = 0; i < maxAttempts; i++) {
      const random = Math.floor(1000 + Math.random() * 9000).toString();
      const orderNumber = `ORD-${dateStr}-${random}`;

      const existing = await tx.order.findUnique({
        where: { orderNumber },
        select: { id: true },
      });

      if (!existing) return orderNumber;
    }

    // Fallback: use timestamp-based number
    return `ORD-${dateStr}-${Date.now().toString().slice(-6)}`;
  }

  private buildDateFilter(
    query: OrderQueryDto,
  ): Prisma.OrderWhereInput {
    if (!query.dateFrom && !query.dateTo) return {};

    const createdAt: Prisma.DateTimeFilter = {};
    if (query.dateFrom) createdAt.gte = new Date(query.dateFrom);
    if (query.dateTo) createdAt.lte = new Date(query.dateTo);

    return { createdAt };
  }
}
