import {
  BadRequestException,
  HttpStatus,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';

const userId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';

const authUser = {
  id: userId,
  email: 'customer@example.com',
  roles: ['CUSTOMER'],
  permissions: ['manage:cart'],
};

const cartFixture = {
  id: '44444444-4444-4444-8444-444444444444',
  userId,
  items: [
    {
      id: itemId,
      productId,
      quantity: 2,
      unitPrice: 100,
      subtotal: 200,
      product: {
        id: productId,
        name: 'Phone',
        slug: 'phone',
        price: 100,
        stock: 10,
        isActive: true,
        deletedAt: null,
        images: [],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  summary: {
    totalItems: 2,
    totalAmount: 200,
  },
};

const mockCartService = {
  getCart: jest.fn(),
  addItem: jest.fn(),
  updateItemQuantity: jest.fn(),
  removeItem: jest.fn(),
  clearCart: jest.fn(),
  validateCart: jest.fn(),
};

function buildApp(): Promise<INestApplication> {
  return Test.createTestingModule({
    controllers: [CartController],
    providers: [{ provide: CartService, useValue: mockCartService }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: import('@nestjs/common').ExecutionContext) => {
        ctx.switchToHttp().getRequest().user = authUser;
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
          req.user = authUser;
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

describe('CartController (integration)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    jest.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /cart', () => {
    it('returns current user cart', async () => {
      mockCartService.getCart.mockResolvedValue(cartFixture);

      const { status, body } = await request(app.getHttpServer()).get('/cart');

      expect(status).toBe(HttpStatus.OK);
      expect(body.summary.totalItems).toBe(2);
      expect(mockCartService.getCart).toHaveBeenCalledWith(userId);
    });
  });

  describe('POST /cart/items', () => {
    it('adds item to cart', async () => {
      mockCartService.addItem.mockResolvedValue(cartFixture);

      const { status } = await request(app.getHttpServer())
        .post('/cart/items')
        .send({ productId, quantity: 2 });

      expect(status).toBe(HttpStatus.CREATED);
      expect(mockCartService.addItem).toHaveBeenCalledWith(userId, {
        productId,
        quantity: 2,
      });
    });

    it('returns 400 for invalid payload', async () => {
      const { status } = await request(app.getHttpServer())
        .post('/cart/items')
        .send({ productId: 'not-a-uuid', quantity: 0 });

      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('returns 404 when product not found', async () => {
      mockCartService.addItem.mockRejectedValue(
        new NotFoundException('Product not found'),
      );

      const { status } = await request(app.getHttpServer())
        .post('/cart/items')
        .send({ productId, quantity: 1 });

      expect(status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('PATCH /cart/items/:id', () => {
    it('updates item quantity', async () => {
      mockCartService.updateItemQuantity.mockResolvedValue(cartFixture);

      const { status } = await request(app.getHttpServer())
        .patch(`/cart/items/${itemId}`)
        .send({ quantity: 3 });

      expect(status).toBe(HttpStatus.OK);
      expect(mockCartService.updateItemQuantity).toHaveBeenCalledWith(
        userId,
        itemId,
        3,
      );
    });

    it('returns 400 for invalid UUID path param', async () => {
      const { status } = await request(app.getHttpServer())
        .patch('/cart/items/not-a-uuid')
        .send({ quantity: 3 });

      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('returns 400 when service rejects quantity constraints', async () => {
      mockCartService.updateItemQuantity.mockRejectedValue(
        new BadRequestException('Requested quantity exceeds available stock'),
      );

      const { status } = await request(app.getHttpServer())
        .patch(`/cart/items/${itemId}`)
        .send({ quantity: 200 });

      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  describe('DELETE /cart/items/:id', () => {
    it('removes one item from cart', async () => {
      mockCartService.removeItem.mockResolvedValue({
        ...cartFixture,
        items: [],
      });

      const { status, body } = await request(app.getHttpServer()).delete(
        `/cart/items/${itemId}`,
      );

      expect(status).toBe(HttpStatus.OK);
      expect(body.items).toHaveLength(0);
    });
  });

  describe('DELETE /cart', () => {
    it('clears cart', async () => {
      mockCartService.clearCart.mockResolvedValue({
        ...cartFixture,
        items: [],
      });

      const { status, body } = await request(app.getHttpServer()).delete(
        '/cart',
      );

      expect(status).toBe(HttpStatus.OK);
      expect(body.items).toHaveLength(0);
      expect(mockCartService.clearCart).toHaveBeenCalledWith(userId);
    });
  });

  describe('GET /cart/validate', () => {
    it('returns cart validation result', async () => {
      mockCartService.validateCart.mockResolvedValue({
        valid: false,
        issues: ['Issue A'],
      });

      const { status, body } = await request(app.getHttpServer()).get(
        '/cart/validate',
      );

      expect(status).toBe(HttpStatus.OK);
      expect(body.valid).toBe(false);
      expect(body.issues).toHaveLength(1);
      expect(mockCartService.validateCart).toHaveBeenCalledWith(userId);
    });
  });
});
