import { Test, TestingModule } from '@nestjs/testing';
import { WishlistController } from './wishlist.controller';
import { WishlistService } from './wishlist.service';

const mockWishlistService = {
  getWishlist: jest.fn(),
  addItem: jest.fn(),
  removeItem: jest.fn(),
  isInWishlist: jest.fn(),
  moveToCart: jest.fn(),
};

describe('WishlistController', () => {
  let controller: WishlistController;
  let service: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WishlistController],
      providers: [
        { provide: WishlistService, useValue: mockWishlistService },
      ],
    }).compile();

    controller = module.get<WishlistController>(WishlistController);
    service = module.get(WishlistService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getWishlist', () => {
    it('should return wishlist of user', async () => {
      const userId = 'user-123';
      const mockData = [{ id: 'item-1', productId: 'prod-1' }];
      service.getWishlist.mockResolvedValue(mockData);

      const result = await controller.getWishlist(userId);
      expect(service.getWishlist).toHaveBeenCalledWith(userId);
      expect(result).toEqual(mockData);
    });
  });

  describe('addItem', () => {
    it('should add item to wishlist', async () => {
      const userId = 'user-123';
      const productId = 'prod-1';
      service.addItem.mockResolvedValue({ id: 'item-1' });

      const result = await controller.addItem(userId, productId);
      expect(service.addItem).toHaveBeenCalledWith(userId, productId);
      expect(result).toEqual({ id: 'item-1' });
    });
  });

  describe('removeItem', () => {
    it('should remove item from wishlist', async () => {
      const userId = 'user-123';
      const productId = 'prod-1';
      service.removeItem.mockResolvedValue(undefined);

      const result = await controller.removeItem(userId, productId);
      expect(service.removeItem).toHaveBeenCalledWith(userId, productId);
      expect(result).toBeUndefined();
    });
  });

  describe('isInWishlist', () => {
    it('should return boolean status of wishlist', async () => {
      const userId = 'user-123';
      const productId = 'prod-1';
      service.isInWishlist.mockResolvedValue({ inWishlist: true });

      const result = await controller.isInWishlist(userId, productId);
      expect(service.isInWishlist).toHaveBeenCalledWith(userId, productId);
      expect(result).toEqual({ inWishlist: true });
    });
  });

  describe('moveToCart', () => {
    it('should move item to cart', async () => {
      const userId = 'user-123';
      const productId = 'prod-1';
      service.moveToCart.mockResolvedValue({ success: true });

      const result = await controller.moveToCart(userId, productId);
      expect(service.moveToCart).toHaveBeenCalledWith(userId, productId);
      expect(result).toEqual({ success: true });
    });
  });
});

