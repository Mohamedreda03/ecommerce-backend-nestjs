import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const count = await this.client.exists(key);
    return count > 0;
  }

  /**
   * SET key value EX ttlSeconds NX — atomic "set if not exists".
   * Returns true if key was set (lock acquired), false if it already existed.
   * Used for idempotency locks on checkout.
   */
  async setNX(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async setEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  /**
   * Deletes all keys matching the given pattern using SCAN.
   * Useful for cache invalidation (e.g. 'cache:/products*')
   */
  async deleteByPattern(pattern: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = this.client.scanStream({
        match: pattern,
        count: 100,
      });

      const pipeline = this.client.pipeline();
      let keysDeleted = 0;

      stream.on('data', (keys: string[]) => {
        if (keys.length > 0) {
          keys.forEach((key) => pipeline.del(key));
          keysDeleted += keys.length;
        }
      });

      stream.on('end', async () => {
        if (keysDeleted > 0) {
          try {
            await pipeline.exec();
          } catch (err) {
            return reject(err);
          }
        }
        resolve();
      });

      stream.on('error', (err) => {
        reject(err);
      });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
