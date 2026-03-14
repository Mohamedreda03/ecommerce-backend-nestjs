import {
  ConflictException,
  HttpStatus,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RedisService } from '../redis/redis.service';
import { Reflector } from '@nestjs/core';

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
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  deletedAt: null,
  category: null,
  images: [],
  avgRating: 4.5,
  reviewCount: 5,
};

const paginatedFixture = {
  data: [productFixture],
  meta: {
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

const adminUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'admin@example.com',
  roles: ['ADMIN'],
  permissions: ['manage:all'],
};

// ─── Mock ProductsService ─────────────────────────────────────────────────────

const mockProductsService = {
  findAll: jest.fn(),
  findBySlug: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  updateStock: jest.fn(),
  softDelete: jest.fn(),
  restore: jest.fn(),
  addImages: jest.fn(),
  removeImage: jest.fn(),
  reorderImages: jest.fn(),
};

// ─── App builder ─────────────────────────────────────────────────────────────

function buildApp(): Promise<INestApplication> {
  return Test.createTestingModule({
    controllers: [ProductsController],
    providers: [
      { provide: ProductsService, useValue: mockProductsService },
      { provide: RedisService, useValue: { get: jest.fn(), setEx: jest.fn(), deleteByPattern: jest.fn() } },
      Reflector,
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: import('@nestjs/common').ExecutionContext) => {
        ctx.switchToHttp().getRequest().user = adminUser;
        return true;
      },
    })
    .overrideGuard(PermissionsGuard)
    .useValue({ canActivate: () => true })
    .compile()
    .then(async (module: TestingModule) => {
      const app = module.createNestApplication();
      app.use(
        (req: Record<string, unknown>, _res: unknown, next: () => void) => {
          req.user = adminUser;
          next();
        },
      );
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await app.init();
      return app;
    });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProductsController (integration)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    jest.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // ─── GET /products ────────────────────────────────────────────────────────

  describe('GET /products', () => {
    it('returns 200 with paginated products', async () => {
      mockProductsService.findAll.mockResolvedValue(paginatedFixture);

      const { status, body } = await request(app.getHttpServer()).get(
        '/products',
      );
      expect(status).toBe(HttpStatus.OK);
      expect(body.data).toHaveLength(1);
      expect(mockProductsService.findAll).toHaveBeenCalledWith(
        expect.any(Object),
        false,
      );
    });
  });

  // ─── GET /products/admin/all ──────────────────────────────────────────────

  describe('GET /products/admin/all', () => {
    it('returns 200 and calls findAll with adminMode=true', async () => {
      mockProductsService.findAll.mockResolvedValue(paginatedFixture);

      const { status } = await request(app.getHttpServer()).get(
        '/products/admin/all',
      );
      expect(status).toBe(HttpStatus.OK);
      expect(mockProductsService.findAll).toHaveBeenCalledWith(
        expect.any(Object),
        true,
      );
    });
  });

  // ─── GET /products/admin/:id ──────────────────────────────────────────────

  describe('GET /products/admin/:id', () => {
    it('returns 200 with product by id', async () => {
      mockProductsService.findById.mockResolvedValue(productFixture);

      const { status, body } = await request(app.getHttpServer()).get(
        `/products/admin/${productId}`,
      );
      expect(status).toBe(HttpStatus.OK);
      expect(body.id).toBe(productId);
      expect(mockProductsService.findById).toHaveBeenCalledWith(productId);
    });

    it('returns 404 when product not found', async () => {
      mockProductsService.findById.mockRejectedValue(new NotFoundException());

      const { status } = await request(app.getHttpServer()).get(
        `/products/admin/${productId}`,
      );
      expect(status).toBe(HttpStatus.NOT_FOUND);
    });

    it('returns 400 for invalid UUID', async () => {
      const { status } = await request(app.getHttpServer()).get(
        '/products/admin/not-a-uuid',
      );
      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── GET /products/:slug ──────────────────────────────────────────────────

  describe('GET /products/:slug', () => {
    it('returns 200 with product by slug', async () => {
      mockProductsService.findBySlug.mockResolvedValue(productFixture);

      const { status, body } = await request(app.getHttpServer()).get(
        '/products/test-product',
      );
      expect(status).toBe(HttpStatus.OK);
      expect(body.slug).toBe('test-product');
      expect(mockProductsService.findBySlug).toHaveBeenCalledWith(
        'test-product',
      );
    });

    it('returns 404 when slug not found', async () => {
      mockProductsService.findBySlug.mockRejectedValue(new NotFoundException());

      const { status } = await request(app.getHttpServer()).get(
        '/products/unknown-slug',
      );
      expect(status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  // ─── POST /products ───────────────────────────────────────────────────────

  describe('POST /products', () => {
    const createPayload = {
      name: 'New Product',
      price: 49.99,
      sku: 'NEW-SKU-001',
    };

    it('returns 201 on successful creation', async () => {
      mockProductsService.create.mockResolvedValue(productFixture);

      const { status } = await request(app.getHttpServer())
        .post('/products')
        .send(createPayload);
      expect(status).toBe(HttpStatus.CREATED);
      expect(mockProductsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Product' }),
      );
    });

    it('returns 400 for missing required fields', async () => {
      const { status } = await request(app.getHttpServer())
        .post('/products')
        .send({ name: 'Missing price and sku' });
      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('returns 400 for invalid categoryId', async () => {
      const { status } = await request(app.getHttpServer())
        .post('/products')
        .send({ ...createPayload, categoryId: 'not-a-uuid' });
      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── PATCH /products/:id/stock ────────────────────────────────────────────

  describe('PATCH /products/:id/stock', () => {
    it('returns 200 on success', async () => {
      mockProductsService.updateStock.mockResolvedValue({
        id: productId,
        stock: 15,
        lowStockThreshold: 3,
      });

      const { status } = await request(app.getHttpServer())
        .patch(`/products/${productId}/stock`)
        .send({ quantity: 5, operation: 'increment' });
      expect(status).toBe(HttpStatus.OK);
      expect(mockProductsService.updateStock).toHaveBeenCalledWith(
        productId,
        5,
        'increment',
      );
    });

    it('returns 400 for invalid operation', async () => {
      const { status } = await request(app.getHttpServer())
        .patch(`/products/${productId}/stock`)
        .send({ quantity: 5, operation: 'multiply' });
      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── PATCH /products/:id/restore ─────────────────────────────────────────

  describe('PATCH /products/:id/restore', () => {
    it('returns 200 on success', async () => {
      mockProductsService.restore.mockResolvedValue(productFixture);

      const { status } = await request(app.getHttpServer()).patch(
        `/products/${productId}/restore`,
      );
      expect(status).toBe(HttpStatus.OK);
    });

    it('returns 409 when product is not deleted', async () => {
      mockProductsService.restore.mockRejectedValue(new ConflictException());

      const { status } = await request(app.getHttpServer()).patch(
        `/products/${productId}/restore`,
      );
      expect(status).toBe(HttpStatus.CONFLICT);
    });
  });

  // ─── PATCH /products/:id/images/reorder ──────────────────────────────────

  describe('PATCH /products/:id/images/reorder', () => {
    it('returns 200 on success', async () => {
      mockProductsService.reorderImages.mockResolvedValue(undefined);

      const { status } = await request(app.getHttpServer())
        .patch(`/products/${productId}/images/reorder`)
        .send({ imageIds: [imageId] });
      expect(status).toBe(HttpStatus.OK);
      expect(mockProductsService.reorderImages).toHaveBeenCalledWith(
        productId,
        [imageId],
      );
    });

    it('returns 400 for invalid image UUID', async () => {
      const { status } = await request(app.getHttpServer())
        .patch(`/products/${productId}/images/reorder`)
        .send({ imageIds: ['not-a-uuid'] });
      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── PATCH /products/:id ──────────────────────────────────────────────────

  describe('PATCH /products/:id', () => {
    it('returns 200 on successful update', async () => {
      mockProductsService.update.mockResolvedValue({
        ...productFixture,
        name: 'Updated Name',
      });

      const { status, body } = await request(app.getHttpServer())
        .patch(`/products/${productId}`)
        .send({ name: 'Updated Name' });
      expect(status).toBe(HttpStatus.OK);
      expect(body.name).toBe('Updated Name');
    });

    it('returns 404 when product not found', async () => {
      mockProductsService.update.mockRejectedValue(new NotFoundException());

      const { status } = await request(app.getHttpServer())
        .patch(`/products/${productId}`)
        .send({ name: 'Updated' });
      expect(status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  // ─── DELETE /products/images/:imageId ────────────────────────────────────

  describe('DELETE /products/images/:imageId', () => {
    it('returns 204 on success', async () => {
      mockProductsService.removeImage.mockResolvedValue(undefined);

      const { status } = await request(app.getHttpServer()).delete(
        `/products/images/${imageId}`,
      );
      expect(status).toBe(HttpStatus.NO_CONTENT);
      expect(mockProductsService.removeImage).toHaveBeenCalledWith(imageId);
    });

    it('returns 404 when image not found', async () => {
      mockProductsService.removeImage.mockRejectedValue(
        new NotFoundException(),
      );

      const { status } = await request(app.getHttpServer()).delete(
        `/products/images/${imageId}`,
      );
      expect(status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  // ─── DELETE /products/:id ─────────────────────────────────────────────────

  describe('DELETE /products/:id', () => {
    it('returns 204 on success', async () => {
      mockProductsService.softDelete.mockResolvedValue(undefined);

      const { status } = await request(app.getHttpServer()).delete(
        `/products/${productId}`,
      );
      expect(status).toBe(HttpStatus.NO_CONTENT);
    });

    it('returns 404 when product not found', async () => {
      mockProductsService.softDelete.mockRejectedValue(new NotFoundException());

      const { status } = await request(app.getHttpServer()).delete(
        `/products/${productId}`,
      );
      expect(status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  // ─── POST /products/:id/images ────────────────────────────────────────────

  describe('POST /products/:id/images', () => {
    it('returns 201 on success', async () => {
      mockProductsService.addImages.mockResolvedValue({
        ...productFixture,
        images: [
          {
            id: imageId,
            url: 'http://example.com/img.jpg',
            alt: null,
            sortOrder: 0,
          },
        ],
      });

      const { status, body } = await request(app.getHttpServer())
        .post(`/products/${productId}/images`)
        .send({ images: [{ url: 'http://example.com/img.jpg' }] });
      expect(status).toBe(HttpStatus.CREATED);
      expect(body.images).toHaveLength(1);
    });

    it('returns 400 for missing images array', async () => {
      const { status } = await request(app.getHttpServer())
        .post(`/products/${productId}/images`)
        .send({});
      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });
});
