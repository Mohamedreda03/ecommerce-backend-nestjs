import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { generateSlug } from '../common/utils/slug.util';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';

const PRODUCT_FULL_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  shortDescription: true,
  price: true,
  compareAtPrice: true,
  sku: true,
  stock: true,
  lowStockThreshold: true,
  weight: true,
  isActive: true,
  isFeatured: true,
  categoryId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  category: {
    select: { id: true, name: true, slug: true },
  },
  images: {
    select: { id: true, url: true, alt: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' as const },
  },
} as const;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ProductQueryDto, adminMode = false) {
    const {
      page,
      limit,
      sortBy = 'createdAt',
      sortOrder = 'asc',
      categoryId,
      minPrice,
      maxPrice,
      search,
      isActive,
      isFeatured,
    } = query;

    const skip = (page - 1) * limit;

    const priceFilter: Record<string, number> = {};
    if (minPrice !== undefined) priceFilter.gte = minPrice;
    if (maxPrice !== undefined) priceFilter.lte = maxPrice;

    const validSortFields = ['createdAt', 'name', 'price', 'stock'];
    const orderByField = validSortFields.includes(sortBy)
      ? sortBy
      : 'createdAt';

    const where = {
      ...(!adminMode ? { isActive: true, deletedAt: null } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(Object.keys(priceFilter).length ? { price: priceFilter } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              {
                description: { contains: search, mode: 'insensitive' as const },
              },
            ],
          }
        : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(isFeatured !== undefined ? { isFeatured } : {}),
    };

    const [products, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        select: PRODUCT_FULL_SELECT,
        orderBy: { [orderByField]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return new PaginatedResponseDto(products, total, page, limit);
  }

  async findBySlug(slug: string, isAdmin = false) {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      select: PRODUCT_FULL_SELECT,
    });

    if (
      !product ||
      (!isAdmin && (!product.isActive || product.deletedAt !== null))
    ) {
      throw new NotFoundException(`Product "${slug}" not found`);
    }

    const ratingAgg = await this.prisma.review.aggregate({
      where: { productId: product.id, isApproved: true },
      _avg: { rating: true },
      _count: { rating: true },
    });

    return {
      ...product,
      avgRating: ratingAgg._avg.rating,
      reviewCount: ratingAgg._count.rating,
    };
  }

  async findById(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: PRODUCT_FULL_SELECT,
    });
    if (!product) {
      throw new NotFoundException(`Product "${id}" not found`);
    }
    return product;
  }

  async create(dto: CreateProductDto) {
    const { name, categoryId, ...rest } = dto;

    if (categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: categoryId },
      });
      if (!category) {
        throw new NotFoundException(`Category "${categoryId}" not found`);
      }
    }

    const slug = await generateSlug(name, async (candidate) => {
      const existing = await this.prisma.product.findUnique({
        where: { slug: candidate },
      });
      return existing !== null;
    });

    return this.prisma.product.create({
      data: {
        name,
        slug,
        ...rest,
        ...(categoryId !== undefined ? { categoryId } : {}),
      } as Parameters<typeof this.prisma.product.create>[0]['data'],
      select: PRODUCT_FULL_SELECT,
    });
  }

  async update(id: string, dto: UpdateProductDto) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Product "${id}" not found`);
    }

    const { name, categoryId, ...rest } = dto;

    if (categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: categoryId },
      });
      if (!category) {
        throw new NotFoundException(`Category "${categoryId}" not found`);
      }
    }

    let slug: string | undefined;
    if (name && name !== existing.name) {
      slug = await generateSlug(name, async (candidate) => {
        const found = await this.prisma.product.findFirst({
          where: { slug: candidate, NOT: { id } },
        });
        return found !== null;
      });
    }

    return this.prisma.product.update({
      where: { id },
      data: {
        ...(name ? { name } : {}),
        ...(slug ? { slug } : {}),
        ...(categoryId !== undefined ? { categoryId } : {}),
        ...rest,
      },
      select: PRODUCT_FULL_SELECT,
    });
  }

  async updateStock(
    id: string,
    quantity: number,
    operation: 'increment' | 'decrement' | 'set',
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException(`Product "${id}" not found`);
    }

    if (operation === 'decrement' && product.stock < quantity) {
      throw new BadRequestException(
        `Insufficient stock. Current: ${product.stock}, requested: ${quantity}`,
      );
    }

    const stockData =
      operation === 'set'
        ? { stock: quantity }
        : operation === 'increment'
          ? { stock: { increment: quantity } }
          : { stock: { decrement: quantity } };

    return this.prisma.product.update({
      where: { id },
      data: stockData,
      select: { id: true, stock: true, lowStockThreshold: true },
    });
  }

  async softDelete(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product "${id}" not found`);
    }
    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: PRODUCT_FULL_SELECT,
    });
  }

  async restore(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product "${id}" not found`);
    }
    if (!product.deletedAt) {
      throw new ConflictException(`Product "${id}" is not deleted`);
    }
    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: null },
      select: PRODUCT_FULL_SELECT,
    });
  }

  async addImages(
    productId: string,
    images: { url: string; alt?: string; sortOrder?: number }[],
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException(`Product "${productId}" not found`);
    }

    await this.prisma.productImage.createMany({
      data: images.map((img) => ({ ...img, productId })),
    });

    return this.prisma.product.findUnique({
      where: { id: productId },
      select: PRODUCT_FULL_SELECT,
    });
  }

  async removeImage(imageId: string) {
    const image = await this.prisma.productImage.findUnique({
      where: { id: imageId },
    });
    if (!image) {
      throw new NotFoundException(`Image "${imageId}" not found`);
    }
    await this.prisma.productImage.delete({ where: { id: imageId } });
  }

  async reorderImages(productId: string, imageIds: string[]) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException(`Product "${productId}" not found`);
    }

    await this.prisma.$transaction(
      imageIds.map((id, index) =>
        this.prisma.productImage.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
  }
}
