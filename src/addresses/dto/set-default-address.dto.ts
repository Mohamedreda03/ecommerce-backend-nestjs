import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { AddressType } from '../../common/enums/address-type.enum';

export class SetDefaultAddressDto {
  @ApiProperty({ enum: AddressType, example: AddressType.SHIPPING })
  @IsEnum(AddressType)
  type: AddressType;
}
