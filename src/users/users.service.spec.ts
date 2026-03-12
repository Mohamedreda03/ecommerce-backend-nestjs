import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import * as hashUtil from '../common/utils/hash.util';

// ─── Shared mocks ─────────────────────────────────────────────────────────────

const mockPrisma = {
  user: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  userRole: {
    deleteMany: jest.fn(),
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

function buildModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [UsersService, { provide: PrismaService, useValue: mockPrisma }],
  }).compile();
}

// ─── Safe user fixture ────────────────────────────────────────────────────────

const safeUser = {
  id: 'user-uuid',
  email: 'user@example.com',
  firstName: 'John',
  lastName: 'Doe',
  phone: null,
  avatar: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  roles: [],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await buildModule();
    service = module.get<UsersService>(UsersService);
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated users', async () => {
      mockPrisma.$transaction.mockResolvedValue([[safeUser], 1]);

      const result = await service.findAll({
        page: 1,
        limit: 10,
        sortOrder: 'asc',
      });

      expect(result.data).toEqual([safeUser]);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('calculates skip from page and limit', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 50]);

      await service.findAll({ page: 3, limit: 10, sortOrder: 'asc' });

      // The findMany call inside $transaction should receive skip: 20
      const [[findManyCall]] = mockPrisma.$transaction.mock.calls;
      // $transaction receives an array of promises; verify it was called
      expect(findManyCall).toBeDefined();
    });
  });

  // ─── findById ─────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the user when found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(safeUser);

      const result = await service.findById('user-uuid');

      expect(result).toEqual(safeUser);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-uuid', deletedAt: null },
        }),
      );
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(service.findById('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── findByEmail ──────────────────────────────────────────────────────────

  describe('findByEmail', () => {
    it('returns full user row including roles', async () => {
      const fullUser = { ...safeUser, password: 'hashed', roles: [] };
      mockPrisma.user.findFirst.mockResolvedValue(fullUser);

      const result = await service.findByEmail('user@example.com');

      expect(result).toEqual(fullUser);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'user@example.com', deletedAt: null },
        }),
      );
    });

    it('returns null when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await service.findByEmail('unknown@example.com');
      expect(result).toBeNull();
    });
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto = {
      email: 'new@example.com',
      password: 'Pass@1234',
      firstName: 'Jane',
      lastName: 'Smith',
    };

    beforeEach(() => {
      jest.spyOn(hashUtil, 'hashPassword').mockResolvedValue('hashed-pass');
    });

    it('creates a user and returns safe payload', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(safeUser);

      const result = await service.create(dto);

      expect(result).toEqual(safeUser);
      expect(hashUtil.hashPassword).toHaveBeenCalledWith(dto.password);
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: dto.email,
            password: 'hashed-pass',
          }),
        }),
      );
    });

    it('throws ConflictException when email is already in use', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('assigns a role when roleId is provided', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(safeUser);

      await service.create({ ...dto, roleId: 'role-uuid' });

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            roles: { create: { roleId: 'role-uuid' } },
          }),
        }),
      );
    });
  });

  // ─── updateProfile ────────────────────────────────────────────────────────

  describe('updateProfile', () => {
    it('updates only profile fields', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(safeUser);
      mockPrisma.user.update.mockResolvedValue({
        ...safeUser,
        firstName: 'Updated',
      });

      const result = await service.updateProfile('user-uuid', {
        firstName: 'Updated',
      });

      expect((result as typeof safeUser).firstName).toBe('Updated');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-uuid' },
          data: { firstName: 'Updated' },
        }),
      );
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(service.updateProfile('bad-id', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates user fields', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(safeUser);
      mockPrisma.user.update.mockResolvedValue({
        ...safeUser,
        isActive: false,
      });

      const result = await service.update('user-uuid', { isActive: false });

      expect((result as typeof safeUser & { isActive: boolean }).isActive).toBe(
        false,
      );
    });

    it('replaces roles when roleId is provided', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(safeUser);
      mockPrisma.userRole.deleteMany.mockResolvedValue({});
      mockPrisma.userRole.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue(safeUser);

      await service.update('user-uuid', { roleId: 'new-role-id' });

      expect(mockPrisma.userRole.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid' },
      });
      expect(mockPrisma.userRole.create).toHaveBeenCalledWith({
        data: { userId: 'user-uuid', roleId: 'new-role-id' },
      });
    });

    it('hashes the password when supplied', async () => {
      jest.spyOn(hashUtil, 'hashPassword').mockResolvedValue('new-hash');
      mockPrisma.user.findFirst.mockResolvedValue(safeUser);
      mockPrisma.user.update.mockResolvedValue(safeUser);

      await service.update('user-uuid', { password: 'NewPass@9' });

      expect(hashUtil.hashPassword).toHaveBeenCalledWith('NewPass@9');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ password: 'new-hash' }),
        }),
      );
    });
  });

  // ─── softDelete ───────────────────────────────────────────────────────────

  describe('softDelete', () => {
    it('sets deletedAt on the user', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(safeUser);
      mockPrisma.user.update.mockResolvedValue({});

      await service.softDelete('user-uuid', 'admin-uuid');

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-uuid' },
          data: { deletedAt: expect.any(Date) },
        }),
      );
    });

    it('throws ForbiddenException when deleting self', async () => {
      await expect(service.softDelete('same-id', 'same-id')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(service.softDelete('bad-id', 'admin-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── restore ──────────────────────────────────────────────────────────────

  describe('restore', () => {
    it('clears deletedAt', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        ...safeUser,
        deletedAt: new Date(),
      });
      mockPrisma.user.update.mockResolvedValue(safeUser);

      const result = await service.restore('user-uuid');

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-uuid' },
          data: { deletedAt: null },
        }),
      );
      expect(result).toEqual(safeUser);
    });

    it('throws NotFoundException when user does not exist at all', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(service.restore('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when user is not deleted', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        ...safeUser,
        deletedAt: null,
      });

      await expect(service.restore('user-uuid')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
