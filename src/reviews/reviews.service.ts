import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewQueryDto } from './dto/review-query.dto';
import { Prisma } from '../generated/prisma/client';
import { createPaginatedResponse } from '../common/utils/pagination.util';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, productId: string, dto: CreateReviewDto) {
    const hasPurchasedAndDelivered = await this.prisma.orderItem.findFirst({
      where: {
        productId,
        order: {
          userId,
          status: 'DELIVERED',
        },
      },
    });

    if (!hasPurchasedAndDelivered) {
      throw new ForbiddenException(
        'You can only review products you have purchased and received.',
      );
    }

    return await this.prisma.review.create({
      data: {
        userId,
        productId,
        ...dto,
        isApproved: false,
      },
      include: {
        user: { select: { firstName: true } },
      },
    });
  }

  async findByProduct(productId: string, query: ReviewQueryDto) {
    const {
      page,
      limit,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      rating,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ReviewWhereInput = {
      productId,
      isApproved: true,
    };
    if (rating) where.rating = rating;

    const [data, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: { user: { select: { firstName: true } } },
      }),
      this.prisma.review.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, limit);
  }

  async findByUser(userId: string, query: ReviewQueryDto) {
    const {
      page,
      limit,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      rating,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ReviewWhereInput = { userId };
    if (rating) where.rating = rating;

    const [data, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: { product: { select: { id: true, name: true, slug: true } } },
      }),
      this.prisma.review.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, limit);
  }

  async findPending(query: ReviewQueryDto) {
    const { page, limit, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.ReviewWhereInput = { isApproved: false };

    const [data, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          user: { select: { id: true, firstName: true } },
          product: { select: { id: true, name: true } },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, limit);
  }

  async update(userId: string, reviewId: string, dto: UpdateReviewDto) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
    });
    if (!review) throw new NotFoundException('Review not found');
    if (review.userId !== userId)
      throw new ForbiddenException('You can only update your own review');

    return this.prisma.review.update({
      where: { id: reviewId },
      data: { ...dto, isApproved: false },
    });
  }

  async delete(userId: string, reviewId: string, isAdmin = false) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
    });
    if (!review) throw new NotFoundException('Review not found');
    if (!isAdmin && review.userId !== userId)
      throw new ForbiddenException('You can only delete your own review');

    return this.prisma.review.delete({ where: { id: reviewId } });
  }

  async approve(reviewId: string) {
    return this.prisma.review.update({
      where: { id: reviewId },
      data: { isApproved: true },
    });
  }

  async reject(reviewId: string) {
    return this.prisma.review.delete({
      where: { id: reviewId },
    });
  }

  async getProductRatingStats(productId: string) {
    const [groupRows, aggregate] = await Promise.all([
      this.prisma.review.groupBy({
        by: ['rating'],
        where: { productId, isApproved: true },
        _count: { rating: true },
      }),
      this.prisma.review.aggregate({
        where: { productId, isApproved: true },
        _avg: { rating: true },
        _count: { id: true },
      }),
    ]);

    const distribution: Record<number, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };
    groupRows.forEach((row) => {
      distribution[row.rating] = row._count.rating;
    });

    return {
      averageRating: aggregate._avg.rating || 0,
      totalReviews: aggregate._count.id,
      distribution,
    };
  }
}
