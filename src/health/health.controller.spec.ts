import { Test, TestingModule } from '@nestjs/testing';
import {
  HealthCheckService,
  MemoryHealthIndicator,
  DiskHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: HealthCheckService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: { check: jest.fn() },
        },
        {
          provide: PrismaHealthIndicator,
          useValue: { pingCheck: jest.fn() },
        },
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: MemoryHealthIndicator,
          useValue: { checkHeap: jest.fn(), checkRSS: jest.fn() },
        },
        {
          provide: DiskHealthIndicator,
          useValue: { checkStorage: jest.fn() },
        },
        {
          provide: RedisService,
          useValue: { ping: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthCheckService = module.get<HealthCheckService>(HealthCheckService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call healthCheckService.check with indicators', async () => {
    await controller.check();
    expect(healthCheckService.check).toHaveBeenCalled();
  });
});
