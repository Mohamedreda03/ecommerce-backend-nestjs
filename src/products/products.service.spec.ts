import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import * as slugUtil from '../common/utils/slug.util';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  product: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  productImage: {
    createMany: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  },
  review: {
    aggregate: jest.fn(),
  },
  category: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockRedisService = {
  get: jest.fn(),
  setEx: jest.fn(),
  deleteByPattern: jest.fn(),
};

function buildModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      ProductsService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: RedisService, useValue: mockRedisService },
    ],
  }).compile();
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const productId = '11111111-1111-4111-8111-111111111111';
const categoryId = '22222222-2222-4222-8222-222222222222';
const imageId = '33333333-3333-4333-8333-333333333333';

const productFixture = {
  id: productId,
  name: 'Test Product',
  slug: 'test-product',
  description: 'A description',
  shortDescription: null,
  price: 99.99,
  compareAtPrice: null,
  sku: 'SKU-001',
  stock: 10,
  lowStockThreshold: 3,
  weight: null,
  isActive: true,
  isFeatured: false,
  categoryId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  category: null,
  images: [],
};

const ratingFixture = { _avg: { rating: 4.5 }, _count: { rating: 10 } };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProductsService', () => {
  let service: ProductsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(slugUtil, 'generateSlug').mockResolvedValue('test-product');
    const module = await buildModule();
    service = module.get<ProductsService>(ProductsService);
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated products for public (active + non-deleted only)', async () => {
      mockPrisma.$transaction.mockResolvedValue([[productFixture], 1]);

      const result = await service.findAll({ page: 1, limit: 20 } as never);

      expect(result).toBeInstanceOf(PaginatedResponseDto);
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('passes adminMode=true to include deleted products', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll({ page: 1, limit: 20 } as never, true);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('applies search filter', async () => {
      mockPrisma.$transaction.mockResolvedValue([[productFixture], 1]);

      const result = await service.findAll(
        { page: 1, limit: 20, search: 'test' } as never,
        false,
      );

      expect(result.data).toHaveLength(1);
    });

    it('applies price range filter', async () => {
      mockPrisma.$transaction.mockResolvedValue([[productFixture], 1]);

      const result = await service.findAll(
        { page: 1, limit: 20, minPrice: 10, maxPrice: 200 } as never,
        false,
      );

      expect(result).toBeInstanceOf(PaginatedResponseDto);
    });
  });

  // ─── findBySlug ───────────────────────────────────────────────────────────

  describe('findBySlug', () => {
    it('returns product with avg rating for public', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(productFixture);
      mockPrisma.review.aggregate.mockResolvedValue(ratingFixture);

      const result = await service.findBySlug('test-product');

      expect(result.avgRating).toBe(4.5);
      expect(result.reviewCount).toBe(10);
    });

    it('throws NotFoundException when product not found', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);

      await expect(service.findBySlug('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException for inactive product in public mode', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        ...productFixture,
        isActive: false,
      });

      await expect(service.findBySlug('test-product', false)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns inactive product in admin mode', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        ...productFixture,
        isActive: false,
      });
      mockPrisma.review.aggregate.mockResolvedValue(ratingFixture);

      const result = await service.findBySlug('test-product', true);
      expect(result).toBeDefined();
    });

    it('throws NotFoundException for deleted product in public mode', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        ...productFixture,
        deletedAt: new Date(),
      });

      await expect(service.findBySlug('test-product', false)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── findById ─────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns product by id', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(productFixture);

      const result = await service.findById(productId);
      expect(result).toEqual(productFixture);
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);

      await expect(service.findById(productId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    const createDto = {
      name: 'Test Product',
      price: 99.99,
      sku: 'SKU-001',
    };

    it('creates product with generated slug', async () => {
      mockPrisma.product.create.mockResolvedValue(productFixture);

      const result = await service.create(createDto as never);

      expect(slugUtil.generateSlug).toHaveBeenCalledWith(
        'Test Product',
        expect.any(Function),
      );
      expect(mockPrisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slug: 'test-product' }),
        }),
      );
      expect(result).toEqual(productFixture);
    });

    it('validates categoryId when provided', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ ...createDto, categoryId } as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates product with valid categoryId', async () => {
      mockPrisma.category.findUnique.mockResolvedValue({ id: categoryId });
      mockPrisma.product.create.mockResolvedValue({
        ...productFixture,
        categoryId,
      });

      const result = await service.create({
        ...createDto,
        categoryId,
      } as never);
      expect(result.categoryId).toBe(categoryId);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates product fields', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(productFixture);
      mockPrisma.product.update.mockResolvedValue({
        ...productFixture,
        name: 'Updated',
        slug: 'updated',
      });
      jest.spyOn(slugUtil, 'generateSlug').mockResolvedValue('updated');

      const result = await service.update(productId, { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });

    it('throws NotFoundException when product not found', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.update(productId, { name: 'Updated' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('validates categoryId when updated', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(productFixture);
      mockPrisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.update(productId, { categoryId } as never),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── updateStock ──────────────────────────────────────────────────────────

  describe('updateStock', () => {
    it('increments stock', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        ...productFixture,
        stock: 10,
      });
      mockPrisma.product.update.mockResolvedValue({
        ...productFixture,
        stock: 15,
      });

      const result = await service.updateStock(productId, 5, 'increment');
      expect(mockPrisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { stock: { increment: 5 } },
        }),
      );
      expect(result).toBeDefined();
    });

    it('decrements stock', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        ...productFixture,
        stock: 10,
      });
      mockPrisma.product.update.mockResolvedValue({
        ...productFixture,
        stock: 5,
      });

      await service.updateStock(productId, 5, 'decrement');
      expect(mockPrisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { stock: { decrement: 5 } },
        }),
      );
    });

    it('sets stock to exact value', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        ...productFixture,
        stock: 10,
      });
      mockPrisma.product.update.mockResolvedValue({
        ...productFixture,
        stock: 20,
      });

      await service.updateStock(productId, 20, 'set');
      expect(mockPrisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { stock: 20 } }),
      );
    });

    it('throws BadRequestException on decrement below zero', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        ...productFixture,
        stock: 3,
      });

      await expect(
        service.updateStock(productId, 10, 'decrement'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when product not found', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.updateStock(productId, 5, 'increment'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── softDelete ───────────────────────────────────────────────────────────

  describe('softDelete', () => {
    it('sets deletedAt timestamp', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(productFixture);
      const deleted = { ...productFixture, deletedAt: new Date() };
      mockPrisma.product.update.mockResolvedValue(deleted);

      const result = await service.softDelete(productId);
      expect(result.deletedAt).toBeTruthy();
      expect(mockPrisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);

      await expect(service.softDelete(productId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── restore ──────────────────────────────────────────────────────────────

  describe('restore', () => {
    it('clears deletedAt', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        ...productFixture,
        deletedAt: new Date(),
      });
      mockPrisma.product.update.mockResolvedValue(productFixture);

      const result = await service.restore(productId);
      expect(result.deletedAt).toBeNull();
    });

    it('throws ConflictException when not deleted', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(productFixture); // deletedAt: null

      await expect(service.restore(productId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);

      await expect(service.restore(productId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── addImages ────────────────────────────────────────────────────────────

  describe('addImages', () => {
    it('creates images and returns updated product', async () => {
      const productWithImages = {
        ...productFixture,
        images: [
          {
            id: imageId,
            url: 'http://example.com/img.jpg',
            alt: null,
            sortOrder: 0,
          },
        ],
      };
      mockPrisma.product.findFirst.mockResolvedValue(productFixture);
      mockPrisma.productImage.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.product.findUnique.mockResolvedValue(productWithImages);

      const result = await service.addImages(productId, [
        { url: 'http://example.com/img.jpg' },
      ]);

      expect(mockPrisma.productImage.createMany).toHaveBeenCalledWith({
        data: [{ url: 'http://example.com/img.jpg', productId }],
      });
      expect(result!.images).toHaveLength(1);
    });

    it('throws NotFoundException when product not found', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.addImages(productId, [{ url: 'http://example.com/img.jpg' }]),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── removeImage ──────────────────────────────────────────────────────────

  describe('removeImage', () => {
    it('deletes the image', async () => {
      mockPrisma.productImage.findUnique.mockResolvedValue({
        id: imageId,
        productId,
      });
      mockPrisma.productImage.delete.mockResolvedValue({});

      await service.removeImage(imageId);

      expect(mockPrisma.productImage.delete).toHaveBeenCalledWith({
        where: { id: imageId },
      });
    });

    it('throws NotFoundException when image not found', async () => {
      mockPrisma.productImage.findUnique.mockResolvedValue(null);

      await expect(service.removeImage(imageId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── reorderImages ────────────────────────────────────────────────────────

  describe('reorderImages', () => {
    it('updates sortOrder for each image', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(productFixture);
      mockPrisma.$transaction.mockResolvedValue([]);

      await service.reorderImages(productId, [imageId]);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('throws NotFoundException when product not found', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(service.reorderImages(productId, [imageId])).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
