import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../common/utils/hash.util';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

/** Prisma select that strips all sensitive / internal columns. */
const USER_SAFE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatar: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  roles: {
    select: {
      role: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    paginationDto: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<unknown>> {
    const {
      page,
      limit,
      sortBy = 'createdAt',
      sortOrder = 'asc',
    } = paginationDto;
    const skip = (page - 1) * limit;

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: { deletedAt: null },
        select: USER_SAFE_SELECT,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where: { deletedAt: null } }),
    ]);

    return new PaginatedResponseDto(users, total, page, limit);
  }

  async findById(id: string): Promise<unknown> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: USER_SAFE_SELECT,
    });

    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    return user;
  }

  /** Internal use by AuthService — returns the full row including password. */
  async findByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } },
              },
            },
          },
        },
      },
    });
  }

  async create(dto: CreateUserDto): Promise<unknown> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const hashed = await hashPassword(dto.password);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashed,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        isActive: dto.isActive ?? true,
        ...(dto.roleId && {
          roles: {
            create: { roleId: dto.roleId },
          },
        }),
      },
      select: USER_SAFE_SELECT,
    });

    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<unknown> {
    await this.findById(userId); // validates user exists

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.avatar !== undefined && { avatar: dto.avatar }),
      },
      select: USER_SAFE_SELECT,
    });
  }

  async update(id: string, dto: UpdateUserDto): Promise<unknown> {
    await this.findById(id); // validates user exists

    const { roleId, password, ...rest } = dto;

    const hashedPassword = password ? await hashPassword(password) : undefined;

    if (roleId !== undefined) {
      // Replace all roles with the single provided role
      await this.prisma.userRole.deleteMany({ where: { userId: id } });
      await this.prisma.userRole.create({ data: { userId: id, roleId } });
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        ...rest,
        ...(hashedPassword && { password: hashedPassword }),
      },
      select: USER_SAFE_SELECT,
    });
  }

  async softDelete(id: string, requesterId: string): Promise<void> {
    if (id === requesterId) {
      throw new ForbiddenException('You cannot delete your own account');
    }

    await this.findById(id); // validates user exists

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async restore(id: string): Promise<unknown> {
    const user = await this.prisma.user.findFirst({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    if (!user.deletedAt) {
      throw new ConflictException('User is not deleted');
    }

    return this.prisma.user.update({
      where: { id },
      data: { deletedAt: null },
      select: USER_SAFE_SELECT,
    });
  }
}
