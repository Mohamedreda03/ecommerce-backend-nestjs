import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

export class ReorderImagesDto {
  @ApiProperty({
    type: [String],
    description: 'Image UUIDs in the desired order',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  imageIds: string[];
}
