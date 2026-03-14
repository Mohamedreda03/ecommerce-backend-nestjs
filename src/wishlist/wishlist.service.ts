import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from '../cart/cart.service';

@Injectable()
export class WishlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
  ) {}

  async getWishlist(userId: string) {
    return this.prisma.wishlistItem.findMany({
      where: { userId },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            price: true,
            stock: true,
            isActive: true,
            images: {
              select: { id: true, url: true, alt: true },
              orderBy: { sortOrder: 'asc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addItem(userId: string, productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.prisma.wishlistItem.create({
      data: {
        userId,
        productId,
      },
    });
  }

  async removeItem(userId: string, productId: string) {
    const item = await this.prisma.wishlistItem.findUnique({
      where: {
        userId_productId: { userId, productId },
      },
    });

    if (!item) {
      throw new NotFoundException('Product not in wishlist');
    }

    await this.prisma.wishlistItem.delete({
      where: {
        userId_productId: { userId, productId },
      },
    });
  }

  async isInWishlist(userId: string, productId: string) {
    const count = await this.prisma.wishlistItem.count({
      where: { userId, productId },
    });
    return { inWishlist: count > 0 };
  }

  async moveToCart(userId: string, productId: string) {
    const item = await this.prisma.wishlistItem.findUnique({
      where: {
        userId_productId: { userId, productId },
      },
    });

    if (!item) {
      throw new NotFoundException('Product not in wishlist');
    }

    await this.cartService.addItem(userId, { productId, quantity: 1 });

    await this.prisma.wishlistItem.delete({
      where: {
        userId_productId: { userId, productId },
      },
    });

    return { success: true };
  }
}

