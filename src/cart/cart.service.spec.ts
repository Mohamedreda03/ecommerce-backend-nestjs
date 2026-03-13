import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from './cart.service';

const mockPrisma = {
  cart: {
    findUnique: jest.fn(),
    create: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
  cartItem: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  product: {
    findFirst: jest.fn(),
  },
};

function buildModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [CartService, { provide: PrismaService, useValue: mockPrisma }],
  }).compile();
}

const userId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';
const itemId = '44444444-4444-4444-8444-444444444444';

const cartWithItemsFixture = {
  id: cartId,
  userId,
  items: [
    {
      id: itemId,
      productId,
      quantity: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
      product: {
        id: productId,
        name: 'Phone',
        slug: 'phone',
        price: 100,
        stock: 5,
        isActive: true,
        deletedAt: null,
        images: [],
      },
    },
  ],
};

describe('CartService', () => {
  let service: CartService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await buildModule();
    service = module.get<CartService>(CartService);
  });

  describe('getCart', () => {
    it('creates cart if missing and returns computed totals', async () => {
      mockPrisma.cart.findUnique.mockResolvedValueOnce(null);
      mockPrisma.cart.create.mockResolvedValue({ id: cartId, userId });
      mockPrisma.cart.findUniqueOrThrow.mockResolvedValue(cartWithItemsFixture);

      const result = await service.getCart(userId);

      expect(result.summary.totalItems).toBe(2);
      expect(result.summary.totalAmount).toBe(200);
      expect(result.items[0].subtotal).toBe(200);
    });

    it('returns existing cart when found', async () => {
      mockPrisma.cart.findUnique.mockResolvedValueOnce({ id: cartId, userId });
      mockPrisma.cart.findUniqueOrThrow.mockResolvedValue(cartWithItemsFixture);

      const result = await service.getCart(userId);

      expect(result.id).toBe(cartId);
      expect(mockPrisma.cart.create).not.toHaveBeenCalled();
    });
  });

  describe('addItem', () => {
    it('creates cart item when item does not exist', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        id: productId,
        stock: 10,
      });
      mockPrisma.cart.findUnique.mockResolvedValue({ id: cartId, userId });
      mockPrisma.cartItem.findFirst.mockResolvedValue(null);
      mockPrisma.cartItem.create.mockResolvedValue({ id: itemId });
      mockPrisma.cart.findUniqueOrThrow.mockResolvedValue(cartWithItemsFixture);

      await service.addItem(userId, { productId, quantity: 2 });

      expect(mockPrisma.cartItem.create).toHaveBeenCalledWith({
        data: { cartId, productId, quantity: 2 },
      });
    });

    it('updates quantity when item already exists', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        id: productId,
        stock: 10,
      });
      mockPrisma.cart.findUnique.mockResolvedValue({ id: cartId, userId });
      mockPrisma.cartItem.findFirst.mockResolvedValue({
        id: itemId,
        quantity: 2,
      });
      mockPrisma.cartItem.update.mockResolvedValue({ id: itemId });
      mockPrisma.cart.findUniqueOrThrow.mockResolvedValue(cartWithItemsFixture);

      await service.addItem(userId, { productId, quantity: 3 });

      expect(mockPrisma.cartItem.update).toHaveBeenCalledWith({
        where: { id: itemId },
        data: { quantity: 5 },
      });
    });

    it('throws NotFoundException when product is unavailable', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.addItem(userId, { productId, quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when requested quantity exceeds stock', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        id: productId,
        stock: 1,
      });

      await expect(
        service.addItem(userId, { productId, quantity: 2 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateItemQuantity', () => {
    it('updates cart item quantity', async () => {
      mockPrisma.cartItem.findUnique.mockResolvedValue({
        id: itemId,
        quantity: 1,
        cart: { userId },
        product: { id: productId, stock: 5, isActive: true, deletedAt: null },
      });
      mockPrisma.cartItem.update.mockResolvedValue({ id: itemId });
      mockPrisma.cart.findUnique.mockResolvedValue({ id: cartId, userId });
      mockPrisma.cart.findUniqueOrThrow.mockResolvedValue(cartWithItemsFixture);

      await service.updateItemQuantity(userId, itemId, 3);

      expect(mockPrisma.cartItem.update).toHaveBeenCalledWith({
        where: { id: itemId },
        data: { quantity: 3 },
      });
    });

    it('throws NotFoundException for missing/foreign item', async () => {
      mockPrisma.cartItem.findUnique.mockResolvedValue(null);

      await expect(
        service.updateItemQuantity(userId, itemId, 2),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if product becomes unavailable', async () => {
      mockPrisma.cartItem.findUnique.mockResolvedValue({
        id: itemId,
        quantity: 1,
        cart: { userId },
        product: { id: productId, stock: 5, isActive: false, deletedAt: null },
      });

      await expect(
        service.updateItemQuantity(userId, itemId, 2),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeItem', () => {
    it('removes item and returns updated cart', async () => {
      mockPrisma.cartItem.findUnique.mockResolvedValue({
        id: itemId,
        cart: { userId },
      });
      mockPrisma.cartItem.delete.mockResolvedValue({ id: itemId });
      mockPrisma.cart.findUnique.mockResolvedValue({ id: cartId, userId });
      mockPrisma.cart.findUniqueOrThrow.mockResolvedValue({
        id: cartId,
        userId,
        items: [],
      });

      const result = await service.removeItem(userId, itemId);

      expect(mockPrisma.cartItem.delete).toHaveBeenCalledWith({
        where: { id: itemId },
      });
      expect(result.items).toHaveLength(0);
    });
  });

  describe('clearCart', () => {
    it('deletes all items for the user cart', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue({ id: cartId, userId });
      mockPrisma.cartItem.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.cart.findUniqueOrThrow.mockResolvedValue({
        id: cartId,
        userId,
        items: [],
      });

      const result = await service.clearCart(userId);

      expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId },
      });
      expect(result.summary.totalItems).toBe(0);
    });
  });

  describe('validateCart', () => {
    it('returns valid=true with no issues when all items are available', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue({ id: cartId, userId });
      mockPrisma.cartItem.findMany.mockResolvedValue([
        {
          quantity: 2,
          product: { name: 'Phone', stock: 5, isActive: true, deletedAt: null },
        },
      ]);

      const result = await service.validateCart(userId);

      expect(result).toEqual({ valid: true, issues: [] });
    });

    it('returns issues for unavailable and insufficient-stock products', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue({ id: cartId, userId });
      mockPrisma.cartItem.findMany.mockResolvedValue([
        {
          quantity: 1,
          product: {
            name: 'Old Phone',
            stock: 5,
            isActive: false,
            deletedAt: null,
          },
        },
        {
          quantity: 10,
          product: {
            name: 'Laptop',
            stock: 2,
            isActive: true,
            deletedAt: null,
          },
        },
      ]);

      const result = await service.validateCart(userId);

      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(2);
    });
  });
});
