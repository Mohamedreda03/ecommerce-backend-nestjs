import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RolesService } from './roles.service';
import { PrismaService } from '../prisma/prisma.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  role: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  permission: {
    findMany: jest.fn(),
  },
  userRole: {
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
  rolePermission: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

function buildModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [RolesService, { provide: PrismaService, useValue: mockPrisma }],
  }).compile();
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const roleId = '11111111-1111-1111-1111-111111111111';
const permId = '22222222-2222-2222-2222-222222222222';
const userId = '33333333-3333-3333-3333-333333333333';

const roleFixture = {
  id: roleId,
  name: 'EDITOR',
  description: 'Editor role',
  createdAt: new Date(),
  updatedAt: new Date(),
  permissions: [],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RolesService', () => {
  let service: RolesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await buildModule();
    service = module.get<RolesService>(RolesService);
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns all roles', async () => {
      mockPrisma.role.findMany.mockResolvedValue([roleFixture]);
      const result = await service.findAll();
      expect(result).toEqual([roleFixture]);
    });
  });

  // ─── findById ─────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns role when found', async () => {
      mockPrisma.role.findUnique.mockResolvedValue(roleFixture);
      const result = await service.findById(roleId);
      expect(result).toEqual(roleFixture);
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.role.findUnique.mockResolvedValue(null);
      await expect(service.findById(roleId)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto = { name: 'EDITOR', description: 'Editor' };

    it('creates a role without permissions', async () => {
      mockPrisma.role.findUnique.mockResolvedValue(null);
      mockPrisma.role.create.mockResolvedValue(roleFixture);

      const result = await service.create(dto);
      expect(result).toEqual(roleFixture);
    });

    it('throws ConflictException when name is taken', async () => {
      mockPrisma.role.findUnique.mockResolvedValue(roleFixture);
      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('validates permissionIds and creates role with permissions', async () => {
      mockPrisma.role.findUnique.mockResolvedValue(null);
      mockPrisma.permission.findMany.mockResolvedValue([{ id: permId }]);
      mockPrisma.role.create.mockResolvedValue({
        ...roleFixture,
        permissions: [{ permission: { id: permId } }],
      });

      await service.create({ ...dto, permissionIds: [permId] });

      expect(mockPrisma.permission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: [permId] } } }),
      );
    });

    it('throws BadRequestException for invalid permissionIds', async () => {
      mockPrisma.role.findUnique.mockResolvedValue(null);
      mockPrisma.permission.findMany.mockResolvedValue([]); // none found

      await expect(
        service.create({ ...dto, permissionIds: [permId] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates role name and permissions in a transaction', async () => {
      mockPrisma.role.findUnique
        .mockResolvedValueOnce(roleFixture)
        .mockResolvedValueOnce(null);
      mockPrisma.permission.findMany.mockResolvedValue([{ id: permId }]);
      const updated = { ...roleFixture, name: 'UPDATED' };
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
      );
      mockPrisma.role.update.mockResolvedValue(updated);

      const result = await service.update(roleId, {
        name: 'UPDATED',
        permissionIds: [permId],
      });
      expect((result as typeof updated).name).toBe('UPDATED');
    });

    it('throws NotFoundException when role not found', async () => {
      mockPrisma.role.findUnique.mockResolvedValue(null);
      await expect(service.update(roleId, { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when new name is already taken', async () => {
      mockPrisma.role.findUnique
        .mockResolvedValueOnce(roleFixture) // current role
        .mockResolvedValueOnce({ id: 'other', name: 'TAKEN' }); // duplicate name check
      await expect(service.update(roleId, { name: 'TAKEN' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── delete ───────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes a custom role', async () => {
      mockPrisma.role.findUnique.mockResolvedValue(roleFixture);
      mockPrisma.role.delete.mockResolvedValue({});

      await service.delete(roleId);
      expect(mockPrisma.role.delete).toHaveBeenCalledWith({
        where: { id: roleId },
      });
    });

    it('throws ForbiddenException for built-in roles', async () => {
      mockPrisma.role.findUnique.mockResolvedValue({
        ...roleFixture,
        name: 'ADMIN',
      });
      await expect(service.delete(roleId)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when role not found', async () => {
      mockPrisma.role.findUnique.mockResolvedValue(null);
      await expect(service.delete(roleId)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── assignRoleToUser ─────────────────────────────────────────────────────

  describe('assignRoleToUser', () => {
    const dto = { userId, roleId };

    it('assigns a role to a user', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: userId });
      mockPrisma.role.findUnique.mockResolvedValue({ id: roleId });
      mockPrisma.userRole.findUnique.mockResolvedValue(null);
      mockPrisma.userRole.create.mockResolvedValue({ userId, roleId });

      const result = await service.assignRoleToUser(dto);
      expect(result).toEqual({ userId, roleId });
    });

    it('throws NotFoundException when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.role.findUnique.mockResolvedValue({ id: roleId });
      await expect(service.assignRoleToUser(dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when role not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: userId });
      mockPrisma.role.findUnique.mockResolvedValue(null);
      await expect(service.assignRoleToUser(dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when user already has role', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: userId });
      mockPrisma.role.findUnique.mockResolvedValue({ id: roleId });
      mockPrisma.userRole.findUnique.mockResolvedValue({ userId, roleId });
      await expect(service.assignRoleToUser(dto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── removeRoleFromUser ───────────────────────────────────────────────────

  describe('removeRoleFromUser', () => {
    const dto = { userId, roleId };

    it('removes a role from a user with multiple roles', async () => {
      mockPrisma.userRole.findUnique.mockResolvedValue({ userId, roleId });
      mockPrisma.userRole.count.mockResolvedValue(2);
      mockPrisma.userRole.delete.mockResolvedValue({});

      await service.removeRoleFromUser(dto);
      expect(mockPrisma.userRole.delete).toHaveBeenCalled();
    });

    it('throws NotFoundException when user does not have the role', async () => {
      mockPrisma.userRole.findUnique.mockResolvedValue(null);
      await expect(service.removeRoleFromUser(dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when removing the last role', async () => {
      mockPrisma.userRole.findUnique.mockResolvedValue({ userId, roleId });
      mockPrisma.userRole.count.mockResolvedValue(1);
      await expect(service.removeRoleFromUser(dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── getAllPermissions ────────────────────────────────────────────────────

  describe('getAllPermissions', () => {
    it('returns all permissions ordered by subject then action', async () => {
      const perms = [
        { id: permId, action: 'read', subject: 'product', description: null },
      ];
      mockPrisma.permission.findMany.mockResolvedValue(perms);

      const result = await service.getAllPermissions();
      expect(result).toEqual(perms);
    });
  });
});
