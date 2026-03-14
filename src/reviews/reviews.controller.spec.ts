import { Test, TestingModule } from '@nestjs/testing';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

describe('ReviewsController', () => {
  let controller: ReviewsController;
  let mockReviewsService: any;

  beforeEach(async () => {
    mockReviewsService = {
      findByProduct: jest.fn(),
      getProductRatingStats: jest.fn(),
      create: jest.fn(),
      findByUser: jest.fn(),
      findPending: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReviewsController],
      providers: [{ provide: ReviewsService, useValue: mockReviewsService }],
    }).compile();

    controller = module.get<ReviewsController>(ReviewsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
