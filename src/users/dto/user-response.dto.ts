import { Exclude, Expose, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class RoleDto {
  @Expose()
  @ApiProperty()
  id: string;

  @Expose()
  @ApiProperty()
  name: string;
}

@Exclude()
export class UserResponseDto {
  @Expose()
  @ApiProperty()
  id: string;

  @Expose()
  @ApiProperty()
  email: string;

  @Expose()
  @ApiProperty()
  firstName: string;

  @Expose()
  @ApiProperty()
  lastName: string;

  @Expose()
  @ApiPropertyOptional()
  phone?: string | null;

  @Expose()
  @ApiPropertyOptional()
  avatar?: string | null;

  @Expose()
  @ApiProperty()
  isActive: boolean;

  @Expose()
  @Type(() => RoleDto)
  @ApiPropertyOptional({ type: [RoleDto] })
  roles?: RoleDto[];

  @Expose()
  @ApiProperty()
  createdAt: Date;

  @Expose()
  @ApiProperty()
  updatedAt: Date;

  // Explicitly excluded — never serialised
  @Exclude()
  password: string;

  @Exclude()
  refreshToken?: string | null;

  @Exclude()
  passwordResetToken?: string | null;

  @Exclude()
  passwordResetExpires?: Date | null;

  @Exclude()
  deletedAt?: Date | null;

  constructor(partial: Partial<UserResponseDto>) {
    Object.assign(this, partial);
  }
}
