import { Test, TestingModule } from '@nestjs/testing';
import { WishlistService } from './wishlist.service';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { NotFoundException } from '@nestjs/common';

const mockPrismaService = {
  wishlistItem: {
    findMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  product: {
    findUnique: jest.fn(),
  },
};

const mockCartService = {
  addItem: jest.fn(),
};

describe('WishlistService', () => {
  let service: WishlistService;
  let prisma: any;
  let cart: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WishlistService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: CartService, useValue: mockCartService },
      ],
    }).compile();

    service = module.get<WishlistService>(WishlistService);
    prisma = module.get<PrismaService>(PrismaService);
    cart = module.get<CartService>(CartService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addItem', () => {
    it('should add item to wishlist', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'prod-1' });
      prisma.wishlistItem.create.mockResolvedValue({ id: 'item-1' });

      const result = await service.addItem('user-1', 'prod-1');
      expect(result).toEqual({ id: 'item-1' });
      expect(prisma.wishlistItem.create).toHaveBeenCalledWith({ data: { userId: 'user-1', productId: 'prod-1' } });
    });

    it('should throw NotFoundException if product not found', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      await expect(service.addItem('u1', 'p1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeItem', () => {
    it('should remove item', async () => {
      prisma.wishlistItem.findUnique.mockResolvedValue({ id: 'item-1' });
      prisma.wishlistItem.delete.mockResolvedValue({ id: 'item-1' });

      await service.removeItem('u1', 'p1');
      expect(prisma.wishlistItem.delete).toHaveBeenCalled();
    });

    it('should throw NotFoundException if not in wishlist', async () => {
      prisma.wishlistItem.findUnique.mockResolvedValue(null);
      await expect(service.removeItem('u1', 'p1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('moveToCart', () => {
    it('should move item from wishlist to cart', async () => {
      prisma.wishlistItem.findUnique.mockResolvedValue({ id: 'item-1' });
      cart.addItem.mockResolvedValue({});
      prisma.wishlistItem.delete.mockResolvedValue({});

      const res = await service.moveToCart('u1', 'p1');
      expect(res).toEqual({ success: true });
      expect(cart.addItem).toHaveBeenCalledWith('u1', { productId: 'p1', quantity: 1 });
      expect(prisma.wishlistItem.delete).toHaveBeenCalled();
    });

    it('should throw NotFoundException if not in wishlist', async () => {
      prisma.wishlistItem.findUnique.mockResolvedValue(null);
      await expect(service.moveToCart('u1', 'p1')).rejects.toThrow(NotFoundException);
    });
  });
});

