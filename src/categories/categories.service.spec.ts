import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesService } from './categories.service';
import { PrismaService } from '../prisma/prisma.service';
import * as slugUtil from '../common/utils/slug.util';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  category: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
};

function buildModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      CategoriesService,
      { provide: PrismaService, useValue: mockPrisma },
    ],
  }).compile();
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const catId = '11111111-1111-4111-8111-111111111111';
const parentId = '22222222-2222-4222-8222-222222222222';

const catFixture = {
  id: catId,
  name: 'Electronics',
  slug: 'electronics',
  description: null,
  image: null,
  parentId: null,
  isActive: true,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  parent: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CategoriesService', () => {
  let service: CategoriesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(slugUtil, 'generateSlug').mockResolvedValue('electronics');
    const module = await buildModule();
    service = module.get<CategoriesService>(CategoriesService);
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns only active categories when includeInactive=false', async () => {
      mockPrisma.category.findMany.mockResolvedValue([catFixture]);

      const result = await service.findAll(false);

      expect(result).toEqual([catFixture]);
      expect(mockPrisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('returns all categories when includeInactive=true', async () => {
      mockPrisma.category.findMany.mockResolvedValue([catFixture]);

      await service.findAll(true);

      expect(mockPrisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });
  });

  // ─── findTree ─────────────────────────────────────────────────────────────

  describe('findTree', () => {
    it('builds a nested tree from flat data', async () => {
      const child = {
        ...catFixture,
        id: 'child-id',
        parentId: catId,
        name: 'Phones',
      };
      mockPrisma.category.findMany.mockResolvedValue([catFixture, child]);

      const tree = await service.findTree();

      expect(tree).toHaveLength(1);
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].name).toBe('Phones');
    });

    it('returns empty array when no categories', async () => {
      mockPrisma.category.findMany.mockResolvedValue([]);
      const tree = await service.findTree();
      expect(tree).toEqual([]);
    });
  });

  // ─── findBySlug ───────────────────────────────────────────────────────────

  describe('findBySlug', () => {
    it('returns category with product count', async () => {
      const withCount = { ...catFixture, _count: { products: 5 } };
      mockPrisma.category.findUnique.mockResolvedValue(withCount);

      const result = await service.findBySlug('electronics');
      expect((result as typeof withCount)._count.products).toBe(5);
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(null);
      await expect(service.findBySlug('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException for inactive category (public)', async () => {
      mockPrisma.category.findUnique.mockResolvedValue({
        ...catFixture,
        isActive: false,
        _count: { products: 0 },
      });
      await expect(service.findBySlug('electronics', false)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns inactive category for admin', async () => {
      const inactive = {
        ...catFixture,
        isActive: false,
        _count: { products: 0 },
      };
      mockPrisma.category.findUnique.mockResolvedValue(inactive);
      const result = await service.findBySlug('electronics', true);
      expect(result).toBeDefined();
    });
  });

  // ─── findById ─────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns category by id', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(catFixture);
      const result = await service.findById(catId);
      expect(result).toEqual(catFixture);
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(null);
      await expect(service.findById(catId)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a category with generated slug', async () => {
      mockPrisma.category.create.mockResolvedValue(catFixture);

      const result = await service.create({ name: 'Electronics' });

      expect(slugUtil.generateSlug).toHaveBeenCalledWith(
        'Electronics',
        expect.any(Function),
      );
      expect(mockPrisma.category.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slug: 'electronics' }),
        }),
      );
      expect(result).toEqual(catFixture);
    });

    it('validates parentId exists when provided', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(null); // parent not found

      await expect(service.create({ name: 'Sub', parentId })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('creates with valid parentId', async () => {
      mockPrisma.category.findUnique.mockResolvedValue({ id: parentId }); // parent found
      mockPrisma.category.create.mockResolvedValue({ ...catFixture, parentId });

      await service.create({ name: 'Sub', parentId });
      expect(mockPrisma.category.create).toHaveBeenCalled();
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates category fields', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(catFixture);
      mockPrisma.category.update.mockResolvedValue({
        ...catFixture,
        description: 'New desc',
      });

      const result = await service.update(catId, { description: 'New desc' });
      expect((result as Record<string, unknown>)['description']).toBe(
        'New desc',
      );
    });

    it('re-generates slug when name changes', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(catFixture);
      jest.spyOn(slugUtil, 'generateSlug').mockResolvedValue('new-name');
      mockPrisma.category.findFirst.mockResolvedValue(null);
      mockPrisma.category.update.mockResolvedValue({
        ...catFixture,
        name: 'New Name',
        slug: 'new-name',
      });

      await service.update(catId, { name: 'New Name' });
      expect(slugUtil.generateSlug).toHaveBeenCalledWith(
        'New Name',
        expect.any(Function),
      );
    });

    it('throws when setting parentId to self', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(catFixture);
      await expect(service.update(catId, { parentId: catId })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when category not found', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(null);
      await expect(service.update(catId, { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('prevents circular reference (descendant as parent)', async () => {
      const childId = '55555555-5555-4555-8555-555555555555';
      // Category is a parent; child has parentId pointing to catId
      mockPrisma.category.findUnique
        .mockResolvedValueOnce(catFixture) // finding the category to update
        .mockResolvedValueOnce({ id: childId, parentId: null }) // finding candidate parent
        // assertNotDescendant traversal: catId's parent chain
        .mockResolvedValueOnce({ parentId: catId }); // childId's parent = catId → cycle!

      await expect(
        service.update(catId, { parentId: childId }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── delete ───────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes a category with no products', async () => {
      mockPrisma.category.findUnique.mockResolvedValue({
        id: catId,
        _count: { products: 0 },
      });
      mockPrisma.category.updateMany.mockResolvedValue({});
      mockPrisma.category.delete.mockResolvedValue({});

      await service.delete(catId);
      expect(mockPrisma.category.delete).toHaveBeenCalledWith({
        where: { id: catId },
      });
    });

    it('throws ConflictException if category has products and force=false', async () => {
      mockPrisma.category.findUnique.mockResolvedValue({
        id: catId,
        _count: { products: 3 },
      });
      await expect(service.delete(catId, false)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException even with force=true if products exist', async () => {
      mockPrisma.category.findUnique.mockResolvedValue({
        id: catId,
        _count: { products: 1 },
      });
      await expect(service.delete(catId, true)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException when category not found', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(null);
      await expect(service.delete(catId)).rejects.toThrow(NotFoundException);
    });
  });
});
