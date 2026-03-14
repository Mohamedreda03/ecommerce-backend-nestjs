import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AddressType } from '../common/enums/address-type.enum';
import { PrismaService } from '../prisma/prisma.service';
import { AddressesService } from './addresses.service';

const userId = '11111111-1111-4111-8111-111111111111';
const addressId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';

const sampleAddress = {
  id: addressId,
  userId,
  type: AddressType.SHIPPING,
  firstName: 'John',
  lastName: 'Doe',
  street: '123 Main St',
  city: 'Cairo',
  state: 'Cairo Governorate',
  country: 'Egypt',
  zipCode: '11511',
  phone: null,
  isDefault: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const txMock = {
  address: {
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
};

const mockPrisma = {
  address: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  $transaction: jest.fn((callback) => callback(txMock)),
};

function buildModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      AddressesService,
      { provide: PrismaService, useValue: mockPrisma },
    ],
  }).compile();
}

describe('AddressesService', () => {
  let service: AddressesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await buildModule();
    service = module.get<AddressesService>(AddressesService);
  });

  describe('findAllByUser', () => {
    it('returns all addresses ordered by isDefault desc then createdAt desc', async () => {
      mockPrisma.address.findMany.mockResolvedValue([sampleAddress]);

      const result = await service.findAllByUser(userId);

      expect(result).toEqual([sampleAddress]);
      expect(mockPrisma.address.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });
    });
  });

  describe('findById', () => {
    it('returns the address when found and belongs to user', async () => {
      mockPrisma.address.findFirst.mockResolvedValue(sampleAddress);

      const result = await service.findById(userId, addressId);

      expect(result).toEqual(sampleAddress);
      expect(mockPrisma.address.findFirst).toHaveBeenCalledWith({
        where: { id: addressId, userId },
      });
    });

    it('throws NotFoundException when address is not found', async () => {
      mockPrisma.address.findFirst.mockResolvedValue(null);

      await expect(service.findById(userId, addressId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when address belongs to different user', async () => {
      mockPrisma.address.findFirst.mockResolvedValue(null);

      await expect(
        service.findById('other-user-id', addressId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    const createDto = {
      type: AddressType.SHIPPING,
      firstName: 'John',
      lastName: 'Doe',
      street: '123 Main St',
      city: 'Cairo',
      state: 'Cairo Governorate',
      country: 'Egypt',
      zipCode: '11511',
    };

    it('creates address and auto-sets default when first address', async () => {
      txMock.address.count.mockResolvedValue(0);
      txMock.address.updateMany.mockResolvedValue({ count: 0 });
      txMock.address.create.mockResolvedValue({
        ...sampleAddress,
        isDefault: true,
      });

      const result = await service.create(userId, { ...createDto });

      expect(result.isDefault).toBe(true);
      expect(txMock.address.updateMany).toHaveBeenCalled();
      expect(txMock.address.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId, isDefault: true }) }),
      );
    });

    it('does not auto-set default when other addresses exist', async () => {
      txMock.address.count.mockResolvedValue(2);
      txMock.address.create.mockResolvedValue({
        ...sampleAddress,
        isDefault: false,
      });

      const result = await service.create(userId, { ...createDto });

      expect(result.isDefault).toBe(false);
      expect(txMock.address.updateMany).not.toHaveBeenCalled();
    });

    it('unsets previous defaults of same type when isDefault is explicitly true', async () => {
      txMock.address.updateMany.mockResolvedValue({ count: 1 });
      txMock.address.create.mockResolvedValue({
        ...sampleAddress,
        isDefault: true,
      });

      await service.create(userId, { ...createDto, isDefault: true });

      expect(txMock.address.updateMany).toHaveBeenCalledWith({
        where: { userId, type: AddressType.SHIPPING, isDefault: true },
        data: { isDefault: false },
      });
    });
  });

  describe('update', () => {
    it('updates address fields', async () => {
      mockPrisma.address.findFirst.mockResolvedValue(sampleAddress);
      txMock.address.update.mockResolvedValue({ ...sampleAddress, city: 'Alex' });

      const result = await service.update(userId, addressId, { city: 'Alex' });

      expect(result.city).toBe('Alex');
      expect(txMock.address.update).toHaveBeenCalledWith({
        where: { id: addressId },
        data: { city: 'Alex' },
      });
    });

    it('throws NotFoundException if address does not belong to user', async () => {
      mockPrisma.address.findFirst.mockResolvedValue(null);

      await expect(
        service.update(userId, otherId, { city: 'Alex' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('unsets previous defaults when setting isDefault to true', async () => {
      mockPrisma.address.findFirst.mockResolvedValue(sampleAddress);
      txMock.address.findUnique.mockResolvedValue({ type: AddressType.SHIPPING });
      txMock.address.updateMany.mockResolvedValue({ count: 1 });
      txMock.address.update.mockResolvedValue({ ...sampleAddress, isDefault: true });

      await service.update(userId, addressId, { isDefault: true });

      expect(txMock.address.updateMany).toHaveBeenCalledWith({
        where: {
          userId,
          type: AddressType.SHIPPING,
          isDefault: true,
          id: { not: addressId },
        },
        data: { isDefault: false },
      });
    });
  });

  describe('delete', () => {
    it('deletes address and returns success message', async () => {
      mockPrisma.address.findFirst.mockResolvedValue(sampleAddress);
      mockPrisma.address.delete.mockResolvedValue(sampleAddress);

      const result = await service.delete(userId, addressId);

      expect(result).toEqual({ message: 'Address deleted successfully' });
      expect(mockPrisma.address.delete).toHaveBeenCalledWith({
        where: { id: addressId },
      });
    });

    it('throws NotFoundException if address not found or not owned', async () => {
      mockPrisma.address.findFirst.mockResolvedValue(null);

      await expect(service.delete(userId, otherId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('setDefault', () => {
    it('unsets previous defaults and sets new default', async () => {
      mockPrisma.address.findFirst.mockResolvedValue(sampleAddress);
      txMock.address.updateMany.mockResolvedValue({ count: 1 });
      txMock.address.update.mockResolvedValue({ ...sampleAddress, isDefault: true });

      const result = await service.setDefault(
        userId,
        addressId,
        AddressType.SHIPPING,
      );

      expect(result.isDefault).toBe(true);
      expect(txMock.address.updateMany).toHaveBeenCalledWith({
        where: { userId, type: AddressType.SHIPPING, isDefault: true },
        data: { isDefault: false },
      });
      expect(txMock.address.update).toHaveBeenCalledWith({
        where: { id: addressId },
        data: { isDefault: true },
      });
    });

    it('throws NotFoundException if address not found or not owned', async () => {
      mockPrisma.address.findFirst.mockResolvedValue(null);

      await expect(
        service.setDefault(userId, otherId, AddressType.SHIPPING),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
