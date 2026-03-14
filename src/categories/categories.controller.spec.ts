import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RedisService } from '../redis/redis.service';
import { Reflector } from '@nestjs/core';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const catId = '11111111-1111-4111-8111-111111111111';

const catFixture = {
  id: catId,
  name: 'Electronics',
  slug: 'electronics',
  description: null,
  image: null,
  parentId: null,
  isActive: true,
  sortOrder: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  parent: null,
};

const adminUser = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'admin@example.com',
  roles: ['ADMIN'],
  permissions: ['manage:all'],
};

// ─── Mock CategoriesService ───────────────────────────────────────────────────

const mockCategoriesService = {
  findAll: jest.fn(),
  findTree: jest.fn(),
  findBySlug: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

// ─── App builder ─────────────────────────────────────────────────────────────

function buildApp(): Promise<INestApplication> {
  return Test.createTestingModule({
    controllers: [CategoriesController],
    providers: [
      { provide: CategoriesService, useValue: mockCategoriesService },
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

describe('CategoriesController (integration)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    jest.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // ─── GET /categories ─────────────────────────────────────────────────────

  describe('GET /categories', () => {
    it('returns active categories', async () => {
      mockCategoriesService.findAll.mockResolvedValue([catFixture]);

      const { status, body } = await request(app.getHttpServer()).get(
        '/categories',
      );
      expect(status).toBe(HttpStatus.OK);
      expect(body).toHaveLength(1);
      expect(mockCategoriesService.findAll).toHaveBeenCalledWith(false);
    });
  });

  // ─── GET /categories/tree ────────────────────────────────────────────────

  describe('GET /categories/tree', () => {
    it('returns category tree', async () => {
      const tree = [{ ...catFixture, children: [] }];
      mockCategoriesService.findTree.mockResolvedValue(tree);

      const { status, body } = await request(app.getHttpServer()).get(
        '/categories/tree',
      );
      expect(status).toBe(HttpStatus.OK);
      expect(body[0].children).toBeDefined();
    });
  });

  // ─── GET /categories/admin ───────────────────────────────────────────────

  describe('GET /categories/admin', () => {
    it('returns all categories including inactive', async () => {
      mockCategoriesService.findAll.mockResolvedValue([catFixture]);

      const { status } = await request(app.getHttpServer()).get(
        '/categories/admin',
      );
      expect(status).toBe(HttpStatus.OK);
      expect(mockCategoriesService.findAll).toHaveBeenCalledWith(true);
    });
  });

  // ─── GET /categories/:slug ────────────────────────────────────────────────

  describe('GET /categories/:slug', () => {
    it('returns category by slug', async () => {
      mockCategoriesService.findBySlug.mockResolvedValue(catFixture);

      const { status, body } = await request(app.getHttpServer()).get(
        '/categories/electronics',
      );
      expect(status).toBe(HttpStatus.OK);
      expect(body.slug).toBe('electronics');
    });

    it('returns 404 when not found', async () => {
      mockCategoriesService.findBySlug.mockRejectedValue(
        new NotFoundException(),
      );

      const { status } = await request(app.getHttpServer()).get(
        '/categories/unknown',
      );
      expect(status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  // ─── POST /categories ────────────────────────────────────────────────────

  describe('POST /categories', () => {
    it('creates a category and returns 201', async () => {
      mockCategoriesService.create.mockResolvedValue(catFixture);

      const { status, body } = await request(app.getHttpServer())
        .post('/categories')
        .send({ name: 'Electronics' });

      expect(status).toBe(HttpStatus.CREATED);
      expect(body.name).toBe('Electronics');
    });

    it('returns 400 for missing name', async () => {
      const { status } = await request(app.getHttpServer())
        .post('/categories')
        .send({ description: 'No name' });

      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('returns 404 when parentId is invalid', async () => {
      mockCategoriesService.create.mockRejectedValue(new NotFoundException());

      const { status } = await request(app.getHttpServer())
        .post('/categories')
        .send({
          name: 'Sub',
          parentId: '11111111-1111-4111-8111-111111111111',
        });

      expect(status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  // ─── PATCH /categories/:id ────────────────────────────────────────────────

  describe('PATCH /categories/:id', () => {
    it('updates a category', async () => {
      mockCategoriesService.update.mockResolvedValue({
        ...catFixture,
        name: 'Updated',
      });

      const { status, body } = await request(app.getHttpServer())
        .patch(`/categories/${catId}`)
        .send({ name: 'Updated' });

      expect(status).toBe(HttpStatus.OK);
      expect(body.name).toBe('Updated');
    });

    it('returns 400 for self-referential parentId', async () => {
      mockCategoriesService.update.mockRejectedValue(new BadRequestException());

      const { status } = await request(app.getHttpServer())
        .patch(`/categories/${catId}`)
        .send({ parentId: catId });

      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('returns 400 for invalid UUID', async () => {
      const { status } = await request(app.getHttpServer())
        .patch('/categories/not-a-uuid')
        .send({ name: 'X' });

      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── DELETE /categories/:id ───────────────────────────────────────────────

  describe('DELETE /categories/:id', () => {
    it('deletes a category and returns 204', async () => {
      mockCategoriesService.delete.mockResolvedValue(undefined);

      const { status } = await request(app.getHttpServer()).delete(
        `/categories/${catId}`,
      );
      expect(status).toBe(HttpStatus.NO_CONTENT);
    });

    it('returns 409 when category has products', async () => {
      mockCategoriesService.delete.mockRejectedValue(new ConflictException());

      const { status } = await request(app.getHttpServer()).delete(
        `/categories/${catId}`,
      );
      expect(status).toBe(HttpStatus.CONFLICT);
    });

    it('returns 400 for invalid UUID', async () => {
      const { status } = await request(app.getHttpServer()).delete(
        '/categories/not-a-uuid',
      );
      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('passes force=true query param to service', async () => {
      mockCategoriesService.delete.mockResolvedValue(undefined);

      await request(app.getHttpServer()).delete(
        `/categories/${catId}?force=true`,
      );
      expect(mockCategoriesService.delete).toHaveBeenCalledWith(catId, true);
    });
  });
});
