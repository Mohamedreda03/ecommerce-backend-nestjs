import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';

@ApiTags('coupons')
@ApiBearerAuth()
@Controller('coupons')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  // ─── Admin endpoints ──────────────────────────────────────────────────────────

  @Get()
  @Permissions('read:coupon')
  @ApiOperation({ summary: '[Admin] Paginated coupon list' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.couponsService.findAll(query);
  }

  @Get(':id')
  @Permissions('read:coupon')
  @ApiOperation({ summary: '[Admin] Get coupon by ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.couponsService.findById(id);
  }

  @Post()
  @Permissions('create:coupon')
  @ApiOperation({ summary: '[Admin] Create a coupon' })
  create(@Body() dto: CreateCouponDto) {
    return this.couponsService.create(dto);
  }

  @Patch(':id')
  @Permissions('update:coupon')
  @ApiOperation({ summary: '[Admin] Update a coupon' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCouponDto,
  ) {
    return this.couponsService.update(id, dto);
  }

  @Delete(':id')
  @Permissions('delete:coupon')
  @ApiOperation({ summary: '[Admin] Delete a coupon (only if unused)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.couponsService.delete(id);
  }

  // ─── Authenticated user endpoint ──────────────────────────────────────────────

  @Post('validate')
  @ApiOperation({ summary: 'Validate a coupon code against an order subtotal' })
  validate(@Body() dto: ValidateCouponDto) {
    return this.couponsService.validateCoupon(dto.code, Number(dto.orderSubtotal));
  }
}
