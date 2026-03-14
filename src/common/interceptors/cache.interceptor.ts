import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';
import { RedisService } from '../../redis/redis.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { CACHE_TTL_KEY } from '../decorators/cache-ttl.decorator';

@Injectable()
export class CacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CacheInterceptor.name);
  private readonly DEFAULT_TTL = 60; // 60 seconds default

  constructor(
    private readonly redisService: RedisService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest<Request>();

    // Only cache GET requests
    if (request.method !== 'GET') {
      return next.handle();
    }

    // Only cache @Public() endpoints by default in this implementation
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!isPublic) {
      return next.handle();
    }

    const ttl =
      this.reflector.get<number>(CACHE_TTL_KEY, context.getHandler()) ||
      this.DEFAULT_TTL;

    const queryKeys = Object.keys(request.query).sort();
    const sortedQuery = new URLSearchParams();
    queryKeys.forEach((k) => {
      const val = request.query[k];
      if (Array.isArray(val)) {
        val.forEach((v) => sortedQuery.append(k, String(v)));
      } else {
        sortedQuery.append(k, String(val));
      }
    });
    const queryStr = sortedQuery.toString();
    const cacheKey = `cache:${request.path}${queryStr ? '?' + queryStr : ''}`;

    try {
      const cachedData = await this.redisService.get(cacheKey);
      if (cachedData) {
        this.logger.debug(`Cache hit for ${cacheKey}`);
        return of(JSON.parse(cachedData));
      }
    } catch (error) {
      this.logger.warn(
        `Redis get failed for key ${cacheKey}: ${(error as Error).message}`,
      );
      // Continue execution if Redis fails
    }

    this.logger.debug(`Cache miss for ${cacheKey}. Proceeding to handler.`);

    return next.handle().pipe(
      tap((response) => {
        // Run asynchronously without blocking the response
        Promise.resolve(
          this.redisService.setEx(cacheKey, JSON.stringify(response), ttl),
        ).catch((error) => {
          this.logger.warn(
            `Redis set failed for key ${cacheKey}: ${(error as Error).message}`,
          );
        });
      }),
    );
  }
}
