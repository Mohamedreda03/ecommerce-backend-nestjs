import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { CacheInterceptor } from './cache.interceptor';
import { RedisService } from '../../redis/redis.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { CACHE_TTL_KEY } from '../decorators/cache-ttl.decorator';

describe('CacheInterceptor', () => {
  let interceptor: CacheInterceptor;
  let mockRedisService: { get: jest.Mock; setEx: jest.Mock };
  let mockReflector: { getAllAndOverride: jest.Mock; get: jest.Mock };

  beforeEach(() => {
    mockRedisService = {
      get: jest.fn(),
      setEx: jest.fn().mockResolvedValue(undefined),
    };

    mockReflector = {
      getAllAndOverride: jest.fn(),
      get: jest.fn(),
    };

    interceptor = new CacheInterceptor(
      mockRedisService as unknown as RedisService,
      mockReflector as unknown as Reflector,
    );
  });

  const createMockContext = (
    method: string,
    path: string,
    query: Record<string, string> = {},
  ): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          path,
          query,
        }),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as unknown as ExecutionContext;
  };

  const createMockCallHandler = (
    data: any = { data: 'fresh' },
  ): CallHandler => ({
    handle: () => of(data),
  });

  it('should skip caching if method is not GET', async () => {
    const context = createMockContext('POST', '/api/test');
    const next = createMockCallHandler();

    const result = await interceptor.intercept(context, next);
    let output;
    result.subscribe((val) => (output = val));

    expect(output).toEqual({ data: 'fresh' });
    expect(mockReflector.getAllAndOverride).not.toHaveBeenCalled();
    expect(mockRedisService.get).not.toHaveBeenCalled();
  });

  it('should skip caching if endpoint is not public', async () => {
    const context = createMockContext('GET', '/api/test');
    const next = createMockCallHandler();
    mockReflector.getAllAndOverride.mockReturnValue(false);

    const result = await interceptor.intercept(context, next);
    let output;
    result.subscribe((val) => (output = val));

    expect(output).toEqual({ data: 'fresh' });
    expect(mockRedisService.get).not.toHaveBeenCalled();
  });

  it('should return cached data if present', async () => {
    const context = createMockContext('GET', '/api/test', { page: '1' });
    const next = createMockCallHandler();
    mockReflector.getAllAndOverride.mockReturnValue(true);
    mockRedisService.get.mockResolvedValue(JSON.stringify({ cached: true }));

    const result = await interceptor.intercept(context, next);
    let output;
    result.subscribe((val) => (output = val));

    expect(output).toEqual({ cached: true });
    expect(mockRedisService.get).toHaveBeenCalledWith('cache:/api/test?page=1');
    expect(mockRedisService.setEx).not.toHaveBeenCalled();
  });

  it('should set cached data if miss with correct TTL', async () => {
    const context = createMockContext('GET', '/api/test');
    const next = createMockCallHandler({ hello: 'world' });

    mockReflector.getAllAndOverride.mockReturnValue(true);
    mockReflector.get.mockReturnValue(120); // @CacheTTL(120)
    mockRedisService.get.mockResolvedValue(null);

    const result = await interceptor.intercept(context, next);
    let output;
    result.subscribe((val) => (output = val));

    expect(output).toEqual({ hello: 'world' });
    expect(mockRedisService.get).toHaveBeenCalledWith('cache:/api/test');
    expect(mockRedisService.setEx).toHaveBeenCalledWith(
      'cache:/api/test',
      JSON.stringify({ hello: 'world' }),
      120, // Expecting 120 from metadata
    );
  });
});
