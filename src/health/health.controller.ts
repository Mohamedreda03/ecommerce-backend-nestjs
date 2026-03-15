import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  DiskHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { Public } from '../common/decorators/public.decorator';

import * as path from 'path';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prismaIndicator: PrismaHealthIndicator,
    private prismaService: PrismaService,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
    private redisService: RedisService,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Check application health status' })
  check() {
    return this.health.check([
      // Database health
      () => this.prismaIndicator.pingCheck('database', this.prismaService),

      // Redis health
      async () => {
        try {
          await this.redisService.ping();
          return { redis: { status: 'up' } };
        } catch (e) {
          return { redis: { status: 'down', message: e.message } };
        }
      },

      // Memory health: heap usage should be less than 150MB
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),

      // Memory health: RSS should be less than 300MB
      () => this.memory.checkRSS('memory_rss', 300 * 1024 * 1024),

      // Disk health: check if we have at least 5% or 50MB free space in the uploads directory
      () =>
        this.disk.checkStorage('disk', {
          path: path.resolve('uploads'),
          thresholdPercent: 0.95, // 95% used means 5% free
        }),
    ]);
  }
}
