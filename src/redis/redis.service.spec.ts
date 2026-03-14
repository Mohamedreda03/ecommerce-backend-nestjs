import { Test, TestingModule } from '@nestjs/testing';
import { REDIS_CLIENT } from './redis.constants';
import { RedisService } from './redis.service';
import { EventEmitter } from 'events';
import Redis from 'ioredis';

describe('RedisService', () => {
  let service: RedisService;
  let mockRedisClient: jest.Mocked<Partial<Redis>>;

  beforeEach(async () => {
    mockRedisClient = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      quit: jest.fn(),
      scanStream: jest.fn(),
      pipeline: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: REDIS_CLIENT, useValue: mockRedisClient },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('get', () => {
    it('should return the value for an existing key', async () => {
      mockRedisClient.get.mockResolvedValueOnce('hello');
      const result = await service.get('mykey');
      expect(mockRedisClient.get).toHaveBeenCalledWith('mykey');
      expect(result).toBe('hello');
    });

    it('should return null for a missing key', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null);
      const result = await service.get('missing');
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should call set with EX when ttlSeconds is provided', async () => {
      mockRedisClient.set.mockResolvedValueOnce('OK');
      await service.set('k', 'v', 60);
      expect(mockRedisClient.set).toHaveBeenCalledWith('k', 'v', 'EX', 60);
    });

    it('should call set without EX when ttlSeconds is omitted', async () => {
      mockRedisClient.set.mockResolvedValueOnce('OK');
      await service.set('k', 'v');
      expect(mockRedisClient.set).toHaveBeenCalledWith('k', 'v');
    });
  });

  describe('del', () => {
    it('should call del with the key', async () => {
      mockRedisClient.del.mockResolvedValueOnce(1);
      await service.del('k');
      expect(mockRedisClient.del).toHaveBeenCalledWith('k');
    });
  });

  describe('exists', () => {
    it('should return true when key exists', async () => {
      mockRedisClient.exists.mockResolvedValueOnce(1);
      expect(await service.exists('k')).toBe(true);
    });

    it('should return false when key does not exist', async () => {
      mockRedisClient.exists.mockResolvedValueOnce(0);
      expect(await service.exists('k')).toBe(false);
    });
  });

  describe('setNX', () => {
    it('should return true when lock is acquired (key did not exist)', async () => {
      mockRedisClient.set.mockResolvedValueOnce('OK');
      const acquired = await service.setNX('lock:order:123', '1', 30);
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'lock:order:123',
        '1',
        'EX',
        30,
        'NX',
      );
      expect(acquired).toBe(true);
    });

    it('should return false when key already exists (lock not acquired)', async () => {
      mockRedisClient.set.mockResolvedValueOnce(null);
      const acquired = await service.setNX('lock:order:123', '1', 30);
      expect(acquired).toBe(false);
    });
  });

  describe('setEx', () => {
    it('should call set with EX TTL', async () => {
      mockRedisClient.set.mockResolvedValueOnce('OK');
      await service.setEx('key', 'value', 120);
      expect(mockRedisClient.set).toHaveBeenCalledWith('key', 'value', 'EX', 120);
    });
  });

  describe('deleteByPattern', () => {
    it('should delete matched keys using pipeline', async () => {
      const mockStream = new EventEmitter();
      mockRedisClient.scanStream.mockReturnValue(mockStream as any);

      const mockPipelineExec = jest.fn().mockResolvedValue([]);
      const mockPipelineDel = jest.fn();
      mockRedisClient.pipeline.mockReturnValue({
        del: mockPipelineDel,
        exec: mockPipelineExec,
      } as any);

      const deletePromise = service.deleteByPattern('cache:/products*');

      mockStream.emit('data', ['key1', 'key2']);
      mockStream.emit('data', ['key3']);
      mockStream.emit('end');

      await deletePromise;

      expect(mockRedisClient.scanStream).toHaveBeenCalledWith({
        match: 'cache:/products*',
        count: 100,
      });
      expect(mockPipelineDel).toHaveBeenCalledTimes(3);
      expect(mockPipelineDel).toHaveBeenCalledWith('key1');
      expect(mockPipelineDel).toHaveBeenCalledWith('key2');
      expect(mockPipelineDel).toHaveBeenCalledWith('key3');
      expect(mockPipelineExec).toHaveBeenCalled();
    });

    it('should resolve immediately if no keys matched', async () => {
      const mockStream = new EventEmitter();
      mockRedisClient.scanStream.mockReturnValue(mockStream as any);

      const mockPipelineExec = jest.fn();
      mockRedisClient.pipeline.mockReturnValue({
        exec: mockPipelineExec,
      } as any);

      const deletePromise = service.deleteByPattern('test*');
      mockStream.emit('end');

      await deletePromise;

      expect(mockPipelineExec).not.toHaveBeenCalled();
    });

    it('should reject if stream errors out', async () => {
      const mockStream = new EventEmitter();
      mockRedisClient.scanStream.mockReturnValue(mockStream as any);
      mockRedisClient.pipeline.mockReturnValue({} as any);

      const deletePromise = service.deleteByPattern('test*');
      const err = new Error('Stream failed');
      
      mockStream.emit('error', err);

      await expect(deletePromise).rejects.toThrow('Stream failed');
    });
  });

  describe('onModuleDestroy', () => {
    it('should call quit on the redis client', async () => {
      mockRedisClient.quit.mockResolvedValueOnce('OK');
      await service.onModuleDestroy();
      expect(mockRedisClient.quit).toHaveBeenCalledTimes(1);
    });
  });
});
