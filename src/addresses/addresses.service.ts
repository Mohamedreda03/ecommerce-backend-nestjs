import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddressType } from '../common/enums/address-type.enum';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByUser(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findById(userId: string, addressId: string) {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });
    if (!address) {
      throw new NotFoundException(`Address with ID "${addressId}" not found`);
    }
    return address;
  }

  async create(userId: string, dto: CreateAddressDto) {
    return this.prisma.$transaction(async (tx) => {
      // If setting as default, first determine effective isDefault value
      let isDefault = dto.isDefault ?? false;

      // Auto-default if this is the user's first address
      if (!isDefault) {
        const count = await tx.address.count({ where: { userId } });
        if (count === 0) isDefault = true;
      }

      // Unset previous defaults of the same type if new address is default
      if (isDefault) {
        await tx.address.updateMany({
          where: { userId, type: dto.type, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.address.create({
        data: {
          ...dto,
          isDefault,
          userId,
        },
      });
    });
  }

  async update(userId: string, addressId: string, dto: UpdateAddressDto) {
    // Verify ownership first
    await this.findById(userId, addressId);

    return this.prisma.$transaction(async (tx) => {
      // If setting as default, unset previous defaults of same type
      if (dto.isDefault) {
        const type = dto.type ?? (await tx.address.findUnique({ where: { id: addressId }, select: { type: true } }))?.type;
        if (type) {
          await tx.address.updateMany({
            where: { userId, type, isDefault: true, id: { not: addressId } },
            data: { isDefault: false },
          });
        }
      }

      return tx.address.update({
        where: { id: addressId },
        data: dto,
      });
    });
  }

  async delete(userId: string, addressId: string) {
    // Verify ownership first
    const address = await this.findById(userId, addressId);
    await this.prisma.address.delete({ where: { id: address.id } });
    return { message: 'Address deleted successfully' };
  }

  async setDefault(userId: string, addressId: string, type: AddressType) {
    // Verify ownership first
    const address = await this.findById(userId, addressId);

    return this.prisma.$transaction(async (tx) => {
      // Unset all defaults of same type for this user
      await tx.address.updateMany({
        where: { userId, type, isDefault: true },
        data: { isDefault: false },
      });

      // Set the new default
      return tx.address.update({
        where: { id: address.id },
        data: { isDefault: true },
      });
    });
  }
}
