import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewQueryDto } from './dto/review-query.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';

@ApiTags('Reviews')
@ApiBearerAuth()
@Controller()
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Public()
  @Get('products/:productId/reviews')
  @ApiOperation({ summary: 'Get approved reviews for a product' })
  findProductReviews(
    @Param('productId') productId: string,
    @Query() query: ReviewQueryDto,
  ) {
    return this.reviewsService.findByProduct(productId, query);
  }

  @Public()
  @Get('products/:productId/reviews/stats')
  @ApiOperation({ summary: 'Get rating statistics for a product' })
  getProductRatingStats(@Param('productId') productId: string) {
    return this.reviewsService.getProductRatingStats(productId);
  }

  @Post('products/:productId/reviews')
  @ApiOperation({ summary: 'Create a review for a product' })
  create(
    @CurrentUser('id') userId: string,
    @Param('productId') productId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewsService.create(userId, productId, dto);
  }

  @Get('reviews/me')
  @ApiOperation({ summary: 'Get my reviews' })
  findMyReviews(
    @CurrentUser('id') userId: string,
    @Query() query: ReviewQueryDto,
  ) {
    return this.reviewsService.findByUser(userId, query);
  }

  @Permissions('read:review')
  @Get('reviews/pending')
  @ApiOperation({ summary: 'Admin: Get pending reviews' })
  findPending(@Query() query: ReviewQueryDto) {
    return this.reviewsService.findPending(query);
  }

  @Patch('reviews/:id')
  @ApiOperation({ summary: 'Update your own review' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id') reviewId: string,
    @Body() dto: UpdateReviewDto,
  ) {
    return this.reviewsService.update(userId, reviewId, dto);
  }

  @Delete('reviews/:id')
  @ApiOperation({ summary: 'Delete your own review' })
  remove(@CurrentUser('id') userId: string, @Param('id') reviewId: string) {
    return this.reviewsService.delete(userId, reviewId, false);
  }

  @Permissions('delete:review')
  @Delete('reviews/admin/:id')
  @ApiOperation({ summary: 'Admin: Delete any review' })
  adminRemove(
    @CurrentUser('id') userId: string,
    @Param('id') reviewId: string,
  ) {
    return this.reviewsService.delete(userId, reviewId, true);
  }

  @Permissions('update:review')
  @Patch('reviews/:id/approve')
  @ApiOperation({ summary: 'Admin: Approve a review' })
  approve(@Param('id') reviewId: string) {
    return this.reviewsService.approve(reviewId);
  }

  @Permissions('update:review')
  @Patch('reviews/:id/reject')
  @ApiOperation({ summary: 'Admin: Reject a review' })
  reject(@Param('id') reviewId: string) {
    return this.reviewsService.reject(reviewId);
  }
}
