import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  HttpStatus,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';

// ─── Mock AuthService ─────────────────────────────────────────────────────────

const mockUser = {
  id: 'user-id',
  email: 'user@example.com',
  firstName: 'John',
  lastName: 'Doe',
  phone: null,
  avatar: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockTokens = {
  accessToken: 'mock-access-token',
  refreshToken: 'mock-refresh-token',
};

const mockAuthService = {
  register: jest.fn(),
  login: jest.fn(),
  refreshTokens: jest.fn(),
  logout: jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
  changePassword: jest.fn(),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildApp(): Promise<INestApplication> {
  return Test.createTestingModule({
    controllers: [AuthController],
    providers: [{ provide: AuthService, useValue: mockAuthService }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: import('@nestjs/common').ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        // Inject a mock authenticated user for protected routes
        req.user = {
          id: 'user-id',
          email: 'user@example.com',
          roles: ['CUSTOMER'],
          permissions: [],
        };
        return true;
      },
    })
    .overrideGuard(PermissionsGuard)
    .useValue({ canActivate: () => true })
    .compile()
    .then(async (module: TestingModule) => {
      const app = module.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
      );
      await app.init();
      return app;
    });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AuthController (integration)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    jest.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // ─── POST /auth/register ───────────────────────────────────────────────────

  describe('POST /auth/register', () => {
    const validBody = {
      email: 'new@example.com',
      password: 'StrongPass@1',
      firstName: 'John',
      lastName: 'Doe',
    };

    it('returns 201 with user and tokens on valid input', async () => {
      mockAuthService.register.mockResolvedValue({
        user: mockUser,
        ...mockTokens,
      });

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send(validBody);

      expect(res.status).toBe(HttpStatus.CREATED);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
    });

    it('returns 400 when password is too weak', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ ...validBody, password: 'weak' });

      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
      expect(mockAuthService.register).not.toHaveBeenCalled();
    });

    it('returns 400 when email is invalid', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ ...validBody, email: 'not-an-email' });

      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('returns 409 when email already exists', async () => {
      mockAuthService.register.mockRejectedValue(
        new ConflictException('Email is already registered'),
      );

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send(validBody);

      expect(res.status).toBe(HttpStatus.CONFLICT);
    });
  });

  // ─── POST /auth/refresh ────────────────────────────────────────────────────

  describe('POST /auth/refresh', () => {
    it('returns new token pair on valid refresh token', async () => {
      mockAuthService.refreshTokens.mockResolvedValue(mockTokens);

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'valid-token' });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body).toHaveProperty('accessToken');
    });

    it('returns 400 when refreshToken is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({});

      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('returns 401 when refresh token is invalid', async () => {
      mockAuthService.refreshTokens.mockRejectedValue(
        new UnauthorizedException('Invalid or expired refresh token'),
      );

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'bad-token' });

      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ─── POST /auth/logout ─────────────────────────────────────────────────────

  describe('POST /auth/logout', () => {
    it('returns 200 with success message', async () => {
      mockAuthService.logout.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', 'Bearer mock-token');

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.message).toBe('Logged out successfully');
      expect(mockAuthService.logout).toHaveBeenCalledWith('user-id');
    });
  });

  // ─── POST /auth/forgot-password ───────────────────────────────────────────

  describe('POST /auth/forgot-password', () => {
    it('returns 200 regardless of whether email exists', async () => {
      mockAuthService.forgotPassword.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'anyone@example.com' });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.message).toMatch(/reset link/i);
    });

    it('returns 400 when email is invalid', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'not-valid' });

      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── POST /auth/reset-password ─────────────────────────────────────────────

  describe('POST /auth/reset-password', () => {
    it('returns 200 on valid token and password', async () => {
      mockAuthService.resetPassword.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'valid-token', newPassword: 'NewPass@1' });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.message).toBe('Password reset successfully');
    });

    it('returns 400 when new password is too weak', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'tok', newPassword: 'weak' });

      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── POST /auth/change-password ───────────────────────────────────────────

  describe('POST /auth/change-password', () => {
    it('returns 200 on valid password change', async () => {
      mockAuthService.changePassword.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', 'Bearer mock-token')
        .send({ currentPassword: 'OldPass@1', newPassword: 'NewPass@1' });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.message).toBe('Password changed successfully');
    });
  });

  // ─── GET /auth/me ─────────────────────────────────────────────────────────

  describe('GET /auth/me', () => {
    it('returns the authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer mock-token');

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.id).toBe('user-id');
    });
  });
});
