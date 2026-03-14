import { Test, TestingModule } from '@nestjs/testing';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { ThrottlerModule, Throttle } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { ThrottlerBehindProxyGuard } from './throttler-behind-proxy.guard';

@Controller('test')
class TestController {
  @Get('default')
  defaultLimit() {
    return 'ok';
  }

  @Get('custom')
  @Throttle({ default: { limit: 2, ttl: 60000 } })
  customLimit() {
    return 'ok';
  }
}

describe('ThrottlerGuard (Integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          {
            name: 'default',
            ttl: 60000,
            limit: 3, // 3 requests per minute for the default test
          },
        ]),
      ],
      controllers: [TestController],
      providers: [
        {
          provide: APP_GUARD,
          useClass: ThrottlerBehindProxyGuard,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should allow requests under the default limit', async () => {
    await request(app.getHttpServer()).get('/test/default').expect(200);
    await request(app.getHttpServer()).get('/test/default').expect(200);
    await request(app.getHttpServer()).get('/test/default').expect(200);
  });

  it('should block requests over the default limit', async () => {
    // 4th request should fail
    await request(app.getHttpServer()).get('/test/default').expect(429);
  });

  it('should respect custom @Throttle decorators', async () => {
    await request(app.getHttpServer()).get('/test/custom').expect(200);
    await request(app.getHttpServer()).get('/test/custom').expect(200);
    // 3rd request should fail because limit is 2
    await request(app.getHttpServer()).get('/test/custom').expect(429);
  });

  it('should track requests using X-Forwarded-For header', async () => {
    // Different IP should get a fresh limit on the default endpoint
    await request(app.getHttpServer())
      .get('/test/default')
      .set('X-Forwarded-For', '192.168.1.100')
      .expect(200);

    await request(app.getHttpServer())
      .get('/test/default')
      .set('X-Forwarded-For', '192.168.1.100')
      .expect(200);

    await request(app.getHttpServer())
      .get('/test/default')
      .set('X-Forwarded-For', '192.168.1.100')
      .expect(200);

    await request(app.getHttpServer())
      .get('/test/default')
      .set('X-Forwarded-For', '192.168.1.100')
      .expect(429);
  });
});
