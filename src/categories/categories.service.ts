import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { generateSlug } from '../common/utils/slug.util';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

const CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  image: true,
  parentId: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  parent: {
    select: { id: true, name: true, slug: true },
  },
} as const;

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image: string | null;
  parentId: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  children: CategoryNode[];
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(includeInactive = false) {
    return this.prisma.category.findMany({
      where: includeInactive ? undefined : { isActive: true },
      select: CATEGORY_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findTree(): Promise<CategoryNode[]> {
    const all = await this.prisma.category.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        image: true,
        parentId: true,
        isActive: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return this.buildTree(all, null, 0);
  }

  async findBySlug(slug: string, isAdmin = false) {
    const category = await this.prisma.category.findUnique({
      where: { slug },
      select: {
        ...CATEGORY_SELECT,
        _count: {
          select: { products: { where: { deletedAt: null, isActive: true } } },
        },
      },
    });

    if (!category || (!isAdmin && !category.isActive)) {
      throw new NotFoundException(`Category "${slug}" not found`);
    }

    return category;
  }

  async findById(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: CATEGORY_SELECT,
    });

    if (!category) throw new NotFoundException(`Category "${id}" not found`);
    return category;
  }

  async create(dto: CreateCategoryDto) {
    if (dto.parentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent)
        throw new NotFoundException(
          `Parent category "${dto.parentId}" not found`,
        );
    }

    const slug = await generateSlug(dto.name, (candidate) =>
      this.prisma.category
        .findUnique({ where: { slug: candidate } })
        .then(Boolean),
    );

    return this.prisma.category.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description,
        parentId: dto.parentId,
        image: dto.image,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
      select: CATEGORY_SELECT,
    });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException(`Category "${id}" not found`);

    // Cycle detection: prevent setting parentId to self or own descendant
    if (dto.parentId !== undefined) {
      if (dto.parentId === id) {
        throw new BadRequestException('A category cannot be its own parent');
      }
      if (dto.parentId !== null) {
        const parent = await this.prisma.category.findUnique({
          where: { id: dto.parentId },
        });
        if (!parent)
          throw new NotFoundException(
            `Parent category "${dto.parentId}" not found`,
          );
        await this.assertNotDescendant(id, dto.parentId);
      }
    }

    let slug = category.slug;
    if (dto.name && dto.name !== category.name) {
      slug = await generateSlug(dto.name, (candidate) =>
        this.prisma.category
          .findFirst({ where: { slug: candidate, NOT: { id } } })
          .then(Boolean),
      );
    }

    return this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name, slug }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.parentId !== undefined && { parentId: dto.parentId }),
        ...(dto.image !== undefined && { image: dto.image }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      select: CATEGORY_SELECT,
    });
  }

  async delete(id: string, force = false) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true, _count: { select: { products: true } } },
    });
    if (!category) throw new NotFoundException(`Category "${id}" not found`);

    if (category._count.products > 0 && !force) {
      throw new ConflictException(
        `Category has ${category._count.products} product(s). Use force=true to delete anyway (products will be unlinked).`,
      );
    }

    if (force && category._count.products > 0) {
      // Orphan products — unset their categoryId is not supported by schema (required field).
      // Instead block with a clear message; callers should reassign products first.
      throw new ConflictException(
        'Cannot force-delete a category that has products. Reassign or delete the products first.',
      );
    }

    // Remove child categories' parentId to avoid FK violation
    await this.prisma.category.updateMany({
      where: { parentId: id },
      data: { parentId: null },
    });

    await this.prisma.category.delete({ where: { id } });
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private buildTree(
    nodes: Omit<CategoryNode, 'children'>[],
    parentId: string | null,
    depth: number,
  ): CategoryNode[] {
    if (depth > 10) return [];
    return nodes
      .filter((n) => n.parentId === parentId)
      .map((n) => ({
        ...n,
        children: this.buildTree(nodes, n.id, depth + 1),
      }));
  }

  /** Throws if `candidateParentId` is a descendant of `categoryId`. */
  private async assertNotDescendant(
    categoryId: string,
    candidateParentId: string,
  ): Promise<void> {
    const visited = new Set<string>();
    let current: string | null = candidateParentId;

    while (current) {
      if (visited.has(current)) break; // already-visited guard
      if (current === categoryId) {
        throw new BadRequestException(
          'Setting this parent would create a circular reference',
        );
      }
      visited.add(current);
      const row = await this.prisma.category.findUnique({
        where: { id: current },
        select: { parentId: true },
      });
      current = row?.parentId ?? null;
    }
  }
}
