import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssignRoleDto } from './dto/assign-role.dto';

const BUILT_IN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER'] as const;

const ROLE_WITH_PERMISSIONS = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  permissions: {
    select: {
      permission: {
        select: {
          id: true,
          action: true,
          subject: true,
          description: true,
        },
      },
    },
  },
} as const;

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.role.findMany({ select: ROLE_WITH_PERMISSIONS });
  }

  async findById(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      select: ROLE_WITH_PERMISSIONS,
    });
    if (!role) throw new NotFoundException(`Role "${id}" not found`);
    return role;
  }

  async create(dto: CreateRoleDto) {
    const existing = await this.prisma.role.findUnique({
      where: { name: dto.name },
    });
    if (existing)
      throw new ConflictException(`Role "${dto.name}" already exists`);

    if (dto.permissionIds?.length) {
      await this.validatePermissionIds(dto.permissionIds);
    }

    return this.prisma.role.create({
      data: {
        name: dto.name,
        description: dto.description,
        ...(dto.permissionIds?.length && {
          permissions: {
            create: dto.permissionIds.map((permissionId) => ({ permissionId })),
          },
        }),
      },
      select: ROLE_WITH_PERMISSIONS,
    });
  }

  async update(id: string, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException(`Role "${id}" not found`);

    if (dto.name && dto.name !== role.name) {
      const dupe = await this.prisma.role.findUnique({
        where: { name: dto.name },
      });
      if (dupe)
        throw new ConflictException(`Role "${dto.name}" already exists`);
    }

    if (dto.permissionIds !== undefined) {
      await this.validatePermissionIds(dto.permissionIds ?? []);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.permissionIds !== undefined) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (dto.permissionIds.length) {
          await tx.rolePermission.createMany({
            data: dto.permissionIds.map((permissionId) => ({
              roleId: id,
              permissionId,
            })),
          });
        }
      }

      return tx.role.update({
        where: { id },
        data: {
          ...(dto.name && { name: dto.name }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
        },
        select: ROLE_WITH_PERMISSIONS,
      });
    });
  }

  async delete(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException(`Role "${id}" not found`);

    if ((BUILT_IN_ROLES as readonly string[]).includes(role.name)) {
      throw new ForbiddenException(
        `Built-in role "${role.name}" cannot be deleted`,
      );
    }

    await this.prisma.role.delete({ where: { id } });
  }

  async assignRoleToUser(dto: AssignRoleDto) {
    const [user, role] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: dto.userId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.role.findUnique({
        where: { id: dto.roleId },
        select: { id: true },
      }),
    ]);
    if (!user) throw new NotFoundException(`User "${dto.userId}" not found`);
    if (!role) throw new NotFoundException(`Role "${dto.roleId}" not found`);

    const existing = await this.prisma.userRole.findUnique({
      where: { userId_roleId: { userId: dto.userId, roleId: dto.roleId } },
    });
    if (existing) throw new ConflictException('User already has this role');

    return this.prisma.userRole.create({
      data: { userId: dto.userId, roleId: dto.roleId },
    });
  }

  async removeRoleFromUser(dto: AssignRoleDto) {
    const record = await this.prisma.userRole.findUnique({
      where: { userId_roleId: { userId: dto.userId, roleId: dto.roleId } },
    });
    if (!record) throw new NotFoundException('User does not have this role');

    const roleCount = await this.prisma.userRole.count({
      where: { userId: dto.userId },
    });
    if (roleCount <= 1) {
      throw new BadRequestException('Cannot remove the last role from a user');
    }

    await this.prisma.userRole.delete({
      where: { userId_roleId: { userId: dto.userId, roleId: dto.roleId } },
    });
  }

  async getAllPermissions() {
    return this.prisma.permission.findMany({
      select: { id: true, action: true, subject: true, description: true },
      orderBy: [{ subject: 'asc' }, { action: 'asc' }],
    });
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async validatePermissionIds(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const found = await this.prisma.permission.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new BadRequestException('One or more permission IDs are invalid');
    }
  }
}
