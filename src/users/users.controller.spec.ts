import {
  ConflictException,
  ForbiddenException,
  HttpStatus,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockUser = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  firstName: 'John',
  lastName: 'Doe',
  phone: null,
  avatar: null,
  isActive: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  roles: [],
};

const adminUser = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'admin@example.com',
  roles: ['ADMIN'],
  permissions: ['manage:all'],
};

// ─── Mock UsersService ────────────────────────────────────────────────────────

const mockUsersService = {
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  updateProfile: jest.fn(),
  update: jest.fn(),
  softDelete: jest.fn(),
  restore: jest.fn(),
};

// ─── App builder ─────────────────────────────────────────────────────────────

function buildApp(authUser = adminUser): Promise<INestApplication> {
  return Test.createTestingModule({
    controllers: [UsersController],
    providers: [{ provide: UsersService, useValue: mockUsersService }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: import('@nestjs/common').ExecutionContext) => {
        ctx.switchToHttp().getRequest().user = authUser;
        return true;
      },
    })
    .overrideGuard(PermissionsGuard)
    .useValue({ canActivate: () => true })
    .compile()
    .then(async (module: TestingModule) => {
      const app = module.createNestApplication();
      // Inject authenticated user for every request since APP_GUARDs are not
      // active in isolated test modules.
      app.use(
        (req: Record<string, unknown>, _res: unknown, next: () => void) => {
          req.user = authUser;
          next();
        },
      );
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await app.init();
      return app;
    });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UsersController (integration)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    jest.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // ─── GET /users ─────────────────────────────────────────────────────────

  describe('GET /users', () => {
    it('returns paginated user list', async () => {
      const paginated = {
        data: [mockUser],
        meta: {
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
      mockUsersService.findAll.mockResolvedValue(paginated);

      const { status, body } = await request(app.getHttpServer()).get('/users');

      expect(status).toBe(HttpStatus.OK);
      expect(body.data).toHaveLength(1);
      expect(mockUsersService.findAll).toHaveBeenCalledTimes(1);
    });

    it('passes page and limit query params', async () => {
      mockUsersService.findAll.mockResolvedValue({ data: [], meta: {} });

      await request(app.getHttpServer()).get('/users?page=2&limit=5');

      expect(mockUsersService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, limit: 5 }),
      );
    });
  });

  // ─── GET /users/profile ─────────────────────────────────────────────────

  describe('GET /users/profile', () => {
    it("returns the authenticated user's own profile", async () => {
      mockUsersService.findById.mockResolvedValue(mockUser);

      const { status, body } = await request(app.getHttpServer()).get(
        '/users/profile',
      );

      expect(status).toBe(HttpStatus.OK);
      expect(body.email).toBe(mockUser.email);
      expect(mockUsersService.findById).toHaveBeenCalledWith(adminUser.id);
    });
  });

  // ─── GET /users/:id ──────────────────────────────────────────────────────

  describe('GET /users/:id', () => {
    it('returns a single user by id', async () => {
      mockUsersService.findById.mockResolvedValue(mockUser);

      const { status, body } = await request(app.getHttpServer()).get(
        `/users/${mockUser.id}`,
      );

      expect(status).toBe(HttpStatus.OK);
      expect(body.id).toBe(mockUser.id);
    });

    it('returns 400 for invalid UUID', async () => {
      const { status } = await request(app.getHttpServer()).get(
        '/users/not-a-uuid',
      );
      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('returns 404 when service throws NotFoundException', async () => {
      mockUsersService.findById.mockRejectedValue(new NotFoundException());

      const { status } = await request(app.getHttpServer()).get(
        `/users/${mockUser.id}`,
      );
      expect(status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  // ─── POST /users ─────────────────────────────────────────────────────────

  describe('POST /users', () => {
    const validBody = {
      email: 'new@example.com',
      password: 'StrongPass@1',
      firstName: 'Jane',
      lastName: 'Smith',
    };

    it('creates and returns a new user', async () => {
      mockUsersService.create.mockResolvedValue(mockUser);

      const { status, body } = await request(app.getHttpServer())
        .post('/users')
        .send(validBody);

      expect(status).toBe(HttpStatus.CREATED);
      expect(body.email).toBeDefined();
    });

    it('returns 409 when email is already in use', async () => {
      mockUsersService.create.mockRejectedValue(new ConflictException());

      const { status } = await request(app.getHttpServer())
        .post('/users')
        .send(validBody);

      expect(status).toBe(HttpStatus.CONFLICT);
    });

    it('returns 400 for missing required fields', async () => {
      const { status } = await request(app.getHttpServer())
        .post('/users')
        .send({ email: 'bad@example.com' });

      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── PATCH /users/profile ────────────────────────────────────────────────

  describe('PATCH /users/profile', () => {
    it('updates the authenticated user profile', async () => {
      mockUsersService.updateProfile.mockResolvedValue({
        ...mockUser,
        firstName: 'Updated',
      });

      const { status, body } = await request(app.getHttpServer())
        .patch('/users/profile')
        .send({ firstName: 'Updated' });

      expect(status).toBe(HttpStatus.OK);
      expect(body.firstName).toBe('Updated');
      expect(mockUsersService.updateProfile).toHaveBeenCalledWith(
        adminUser.id,
        expect.objectContaining({ firstName: 'Updated' }),
      );
    });

    it('returns 400 for unknown fields', async () => {
      const { status } = await request(app.getHttpServer())
        .patch('/users/profile')
        .send({ unknownField: 'value' });

      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── PATCH /users/:id ────────────────────────────────────────────────────

  describe('PATCH /users/:id', () => {
    it('updates a user by id', async () => {
      mockUsersService.update.mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      const { status, body } = await request(app.getHttpServer())
        .patch(`/users/${mockUser.id}`)
        .send({ isActive: false });

      expect(status).toBe(HttpStatus.OK);
      expect(body.isActive).toBe(false);
    });

    it('returns 400 for invalid UUID', async () => {
      const { status } = await request(app.getHttpServer())
        .patch('/users/bad-id')
        .send({ isActive: false });

      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── DELETE /users/:id ───────────────────────────────────────────────────

  describe('DELETE /users/:id', () => {
    it('soft-deletes a user and returns 204', async () => {
      mockUsersService.softDelete.mockResolvedValue(undefined);

      const { status } = await request(app.getHttpServer()).delete(
        `/users/${mockUser.id}`,
      );

      expect(status).toBe(HttpStatus.NO_CONTENT);
      expect(mockUsersService.softDelete).toHaveBeenCalledWith(
        mockUser.id,
        adminUser.id,
      );
    });

    it('returns 403 when attempting to delete self', async () => {
      mockUsersService.softDelete.mockRejectedValue(new ForbiddenException());

      const { status } = await request(app.getHttpServer()).delete(
        `/users/${mockUser.id}`,
      );
      expect(status).toBe(HttpStatus.FORBIDDEN);
    });

    it('returns 400 for invalid UUID', async () => {
      const { status } = await request(app.getHttpServer()).delete(
        '/users/not-uuid',
      );
      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── PATCH /users/:id/restore ────────────────────────────────────────────

  describe('PATCH /users/:id/restore', () => {
    it('restores a soft-deleted user', async () => {
      mockUsersService.restore.mockResolvedValue(mockUser);

      const { status, body } = await request(app.getHttpServer()).patch(
        `/users/${mockUser.id}/restore`,
      );

      expect(status).toBe(HttpStatus.OK);
      expect(body.id).toBe(mockUser.id);
    });

    it('returns 409 when user is not deleted', async () => {
      mockUsersService.restore.mockRejectedValue(new ConflictException());

      const { status } = await request(app.getHttpServer()).patch(
        `/users/${mockUser.id}/restore`,
      );
      expect(status).toBe(HttpStatus.CONFLICT);
    });

    it('returns 400 for invalid UUID', async () => {
      const { status } = await request(app.getHttpServer()).patch(
        '/users/bad-id/restore',
      );
      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });
});
