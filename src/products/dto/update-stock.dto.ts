import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, Min } from 'class-validator';

export class UpdateStockDto {
  @ApiProperty({ example: 10, description: 'Quantity to apply' })
  @IsInt()
  @Min(0)
  quantity: number;

  @ApiProperty({ enum: ['increment', 'decrement', 'set'] })
  @IsIn(['increment', 'decrement', 'set'])
  operation: 'increment' | 'decrement' | 'set';
}
