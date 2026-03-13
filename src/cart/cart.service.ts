import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddToCartDto } from './dto/add-to-cart.dto';

const CART_ITEM_PRODUCT_SELECT = {
  id: true,
  name: true,
  slug: true,
  price: true,
  stock: true,
  isActive: true,
  deletedAt: true,
  images: {
    select: { id: true, url: true, alt: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' as const },
  },
} as const;

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  private async getOrCreateCart(userId: string) {
    const existing = await this.prisma.cart.findUnique({ where: { userId } });
    if (existing) return existing;

    return this.prisma.cart.create({ data: { userId } });
  }

  private buildCartResponse(cart: {
    id: string;
    userId: string;
    items: Array<{
      id: string;
      productId: string;
      quantity: number;
      createdAt: Date;
      updatedAt: Date;
      product: {
        id: string;
        name: string;
        slug: string;
        price: unknown;
        stock: number;
        isActive: boolean;
        deletedAt: Date | null;
        images: Array<{
          id: string;
          url: string;
          alt: string | null;
          sortOrder: number;
        }>;
      };
    }>;
  }) {
    const items = cart.items.map((item) => {
      const unitPrice = Number(item.product.price);
      const subtotal = unitPrice * item.quantity;
      return {
        id: item.id,
        productId: item.productId,
        quantity: item.quantity,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        product: item.product,
        unitPrice,
        subtotal,
      };
    });

    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0);

    return {
      id: cart.id,
      userId: cart.userId,
      items,
      summary: {
        totalItems,
        totalAmount,
      },
    };
  }

  async getCart(userId: string) {
    const cart = await this.getOrCreateCart(userId);

    const fullCart = await this.prisma.cart.findUniqueOrThrow({
      where: { id: cart.id },
      select: {
        id: true,
        userId: true,
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            createdAt: true,
            updatedAt: true,
            product: { select: CART_ITEM_PRODUCT_SELECT },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return this.buildCartResponse(fullCart);
  }

  async addItem(userId: string, dto: AddToCartDto) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: dto.productId,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, stock: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (dto.quantity > product.stock) {
      throw new BadRequestException(
        'Requested quantity exceeds available stock',
      );
    }

    const cart = await this.getOrCreateCart(userId);

    const existingItem = await this.prisma.cartItem.findFirst({
      where: { cartId: cart.id, productId: dto.productId },
      select: { id: true, quantity: true },
    });

    if (existingItem) {
      const newQuantity = existingItem.quantity + dto.quantity;
      if (newQuantity > product.stock) {
        throw new BadRequestException(
          'Requested quantity exceeds available stock',
        );
      }

      await this.prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: newQuantity },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: dto.productId,
          quantity: dto.quantity,
        },
      });
    }

    return this.getCart(userId);
  }

  async updateItemQuantity(userId: string, itemId: string, quantity: number) {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        quantity: true,
        cart: { select: { userId: true } },
        product: {
          select: {
            id: true,
            stock: true,
            isActive: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!item || item.cart.userId !== userId) {
      throw new NotFoundException('Cart item not found');
    }

    if (!item.product.isActive || item.product.deletedAt) {
      throw new BadRequestException('Product is no longer available');
    }

    if (quantity > item.product.stock) {
      throw new BadRequestException(
        'Requested quantity exceeds available stock',
      );
    }

    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity },
    });

    return this.getCart(userId);
  }

  async removeItem(userId: string, itemId: string) {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
      select: { id: true, cart: { select: { userId: true } } },
    });

    if (!item || item.cart.userId !== userId) {
      throw new NotFoundException('Cart item not found');
    }

    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return this.getCart(userId);
  }

  async clearCart(userId: string) {
    const cart = await this.getOrCreateCart(userId);
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return this.getCart(userId);
  }

  async validateCart(
    userId: string,
  ): Promise<{ valid: boolean; issues: string[] }> {
    const cart = await this.getOrCreateCart(userId);
    const items = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id },
      select: {
        quantity: true,
        product: {
          select: {
            name: true,
            stock: true,
            isActive: true,
            deletedAt: true,
          },
        },
      },
    });

    const issues: string[] = [];

    for (const item of items) {
      if (!item.product.isActive || item.product.deletedAt) {
        issues.push(`Product "${item.product.name}" is no longer available`);
        continue;
      }

      if (item.quantity > item.product.stock) {
        issues.push(
          `Product "${item.product.name}" has insufficient stock (requested: ${item.quantity}, available: ${item.product.stock})`,
        );
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}
