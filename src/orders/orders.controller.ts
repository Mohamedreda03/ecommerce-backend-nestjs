import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderQueryDto } from './dto/order-query.dto';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // ─── Checkout ──────────────────────────────────────────────────────────────────

  @Post('checkout')
  @ApiOperation({ summary: 'Checkout — create order from cart' })
  checkout(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.checkout(userId, dto);
  }

  // ─── User orders ──────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Get current user\'s orders' })
  findMyOrders(
    @CurrentUser('id') userId: string,
    @Query() query: OrderQueryDto,
  ) {
    return this.ordersService.findAllByUser(userId, query);
  }

  @Get('admin')
  @Permissions('read:order')
  @ApiOperation({ summary: '[Admin] Get all orders' })
  findAll(@Query() query: OrderQueryDto) {
    return this.ordersService.findAll(query);
  }

  @Get('admin/stats')
  @Permissions('read:analytics')
  @ApiOperation({ summary: '[Admin] Get order statistics' })
  getStats() {
    return this.ordersService.getOrderStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by ID (ownership check for customers)' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string; permissions: string[] },
  ) {
    // If user has read:order permission (admin), skip ownership check
    const hasAdminAccess = user.permissions?.includes('read:order') ||
      user.permissions?.includes('manage:all');
    return this.ordersService.findById(id, hasAdminAccess ? undefined : user.id);
  }

  // ─── Admin status management ───────────────────────────────────────────────────

  @Patch(':id/status')
  @Permissions('update:order')
  @ApiOperation({ summary: '[Admin] Update order status' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, dto);
  }

  // ─── User cancellation ─────────────────────────────────────────────────────────

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel order (user — only PENDING/CONFIRMED)' })
  cancelOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.ordersService.cancelOrder(id, userId);
  }
}
