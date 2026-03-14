import { SetMetadata } from '@nestjs/common';

export const CACHE_TTL_KEY = 'cache_ttl';

/**
 * Decorator to specify the Time-To-Live (TTL) in seconds for the Redis cache.
 * @param seconds TTL in seconds
 */
export const CacheTTL = (seconds: number) => SetMetadata(CACHE_TTL_KEY, seconds);
