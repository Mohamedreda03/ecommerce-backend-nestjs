import {
  BadRequestException,
  ConflictException,
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { RedisService } from '../../redis/redis.service';

const IDEMPOTENCY_TTL = 300; // 5 minutes

@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  constructor(private readonly redis: RedisService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    if (!idempotencyKey) {
      throw new BadRequestException(
        'Idempotency-Key header is required for this endpoint',
      );
    }

    const redisKey = `idempotency:${idempotencyKey}`;

    // Attempt to acquire lock
    const acquired = await this.redis.setNX(
      redisKey,
      'processing',
      IDEMPOTENCY_TTL,
    );

    if (!acquired) {
      // Key already exists — check if processing or cached response
      const storedValue = await this.redis.get(redisKey);

      if (storedValue === 'processing') {
        throw new ConflictException(
          'A request with this Idempotency-Key is currently being processed',
        );
      }

      // Stored value is a cached JSON response — return it
      if (storedValue) {
        try {
          const cached = JSON.parse(storedValue);
          res.status(cached.statusCode ?? 201).json(cached.body);
          return;
        } catch {
          // If parsing fails, treat as conflict
          throw new ConflictException(
            'A request with this Idempotency-Key was already processed',
          );
        }
      }
    }

    // Intercept the response to cache it
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      // Cache the response asynchronously (fire-and-forget)
      const cacheValue = JSON.stringify({
        statusCode: res.statusCode,
        body,
      });
      this.redis
        .set(redisKey, cacheValue, IDEMPOTENCY_TTL)
        .catch(() => {
          /* swallow cache errors */
        });

      return originalJson(body);
    };

    next();
  }
}
