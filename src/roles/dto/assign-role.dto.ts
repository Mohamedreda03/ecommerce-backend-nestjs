import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignRoleDto {
  @ApiProperty({ description: 'User ID' })
  @IsUUID('4')
  userId: string;

  @ApiProperty({ description: 'Role ID' })
  @IsUUID('4')
  roleId: string;
}
