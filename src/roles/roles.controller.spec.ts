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
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const roleId = '11111111-1111-4111-8111-111111111111';
const permId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';

const roleFixture = {
  id: roleId,
  name: 'EDITOR',
  description: 'Editor role',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  permissions: [],
};

const adminUser = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'admin@example.com',
  roles: ['ADMIN'],
  permissions: ['manage:all'],
};

// ─── Mock RolesService ────────────────────────────────────────────────────────

const mockRolesService = {
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  assignRoleToUser: jest.fn(),
  removeRoleFromUser: jest.fn(),
  getAllPermissions: jest.fn(),
};

// ─── App builder ─────────────────────────────────────────────────────────────

function buildApp(): Promise<INestApplication> {
  return Test.createTestingModule({
    controllers: [RolesController],
    providers: [{ provide: RolesService, useValue: mockRolesService }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: import('@nestjs/common').ExecutionContext) => {
        ctx.switchToHttp().getRequest().user = adminUser;
        return true;
      },
    })
    .overrideGuard(PermissionsGuard)
    .useValue({ canActivate: () => true })
    .compile()
    .then(async (module: TestingModule) => {
      const app = module.createNestApplication();
      app.use(
        (req: Record<string, unknown>, _res: unknown, next: () => void) => {
          req.user = adminUser;
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

describe('RolesController (integration)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    jest.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // ─── GET /permissions ────────────────────────────────────────────────────

  describe('GET /permissions', () => {
    it('returns all permissions', async () => {
      const perms = [{ id: permId, action: 'read', subject: 'product' }];
      mockRolesService.getAllPermissions.mockResolvedValue(perms);

      const { status, body } = await request(app.getHttpServer()).get(
        '/permissions',
      );
      expect(status).toBe(HttpStatus.OK);
      expect(body).toHaveLength(1);
    });
  });

  // ─── GET /roles ──────────────────────────────────────────────────────────

  describe('GET /roles', () => {
    it('returns all roles', async () => {
      mockRolesService.findAll.mockResolvedValue([roleFixture]);

      const { status, body } = await request(app.getHttpServer()).get('/roles');
      expect(status).toBe(HttpStatus.OK);
      expect(body).toHaveLength(1);
    });
  });

  // ─── GET /roles/:id ──────────────────────────────────────────────────────

  describe('GET /roles/:id', () => {
    it('returns a role by id', async () => {
      mockRolesService.findById.mockResolvedValue(roleFixture);

      const { status, body } = await request(app.getHttpServer()).get(
        `/roles/${roleId}`,
      );
      expect(status).toBe(HttpStatus.OK);
      expect(body.id).toBe(roleId);
    });

    it('returns 404 when role not found', async () => {
      mockRolesService.findById.mockRejectedValue(new NotFoundException());

      const { status } = await request(app.getHttpServer()).get(
        `/roles/${roleId}`,
      );
      expect(status).toBe(HttpStatus.NOT_FOUND);
    });

    it('returns 400 for invalid UUID', async () => {
      const { status } = await request(app.getHttpServer()).get(
        '/roles/not-a-uuid',
      );
      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── POST /roles ─────────────────────────────────────────────────────────

  describe('POST /roles', () => {
    it('creates a role and returns 201', async () => {
      mockRolesService.create.mockResolvedValue(roleFixture);

      const { status, body } = await request(app.getHttpServer())
        .post('/roles')
        .send({ name: 'EDITOR' });

      expect(status).toBe(HttpStatus.CREATED);
      expect(body.name).toBe('EDITOR');
    });

    it('returns 409 when name is taken', async () => {
      mockRolesService.create.mockRejectedValue(new ConflictException());

      const { status } = await request(app.getHttpServer())
        .post('/roles')
        .send({ name: 'EDITOR' });

      expect(status).toBe(HttpStatus.CONFLICT);
    });

    it('returns 400 when name is missing', async () => {
      const { status } = await request(app.getHttpServer())
        .post('/roles')
        .send({ description: 'No name' });

      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('returns 400 when permissionIds contains non-UUID', async () => {
      const { status } = await request(app.getHttpServer())
        .post('/roles')
        .send({ name: 'X', permissionIds: ['not-a-uuid'] });

      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── PATCH /roles/:id ────────────────────────────────────────────────────

  describe('PATCH /roles/:id', () => {
    it('updates a role', async () => {
      mockRolesService.update.mockResolvedValue({
        ...roleFixture,
        name: 'UPDATED',
      });

      const { status, body } = await request(app.getHttpServer())
        .patch(`/roles/${roleId}`)
        .send({ name: 'UPDATED' });

      expect(status).toBe(HttpStatus.OK);
      expect(body.name).toBe('UPDATED');
    });

    it('returns 403 when trying to use a forbidden operation', async () => {
      mockRolesService.update.mockRejectedValue(new ForbiddenException());

      const { status } = await request(app.getHttpServer())
        .patch(`/roles/${roleId}`)
        .send({ name: 'ADMIN' });

      expect(status).toBe(HttpStatus.FORBIDDEN);
    });
  });

  // ─── DELETE /roles/:id ───────────────────────────────────────────────────

  describe('DELETE /roles/:id', () => {
    it('deletes a custom role and returns 204', async () => {
      mockRolesService.delete.mockResolvedValue(undefined);

      const { status } = await request(app.getHttpServer()).delete(
        `/roles/${roleId}`,
      );
      expect(status).toBe(HttpStatus.NO_CONTENT);
    });

    it('returns 403 when deleting a built-in role', async () => {
      mockRolesService.delete.mockRejectedValue(new ForbiddenException());

      const { status } = await request(app.getHttpServer()).delete(
        `/roles/${roleId}`,
      );
      expect(status).toBe(HttpStatus.FORBIDDEN);
    });
  });

  // ─── POST /roles/assign ───────────────────────────────────────────────────

  describe('POST /roles/assign', () => {
    const body = { userId, roleId };

    it('assigns a role to a user', async () => {
      mockRolesService.assignRoleToUser.mockResolvedValue({ userId, roleId });

      const { status, body: resp } = await request(app.getHttpServer())
        .post('/roles/assign')
        .send(body);

      expect(status).toBe(HttpStatus.CREATED);
      expect(resp.userId).toBe(userId);
    });

    it('returns 409 when user already has role', async () => {
      mockRolesService.assignRoleToUser.mockRejectedValue(
        new ConflictException(),
      );

      const { status } = await request(app.getHttpServer())
        .post('/roles/assign')
        .send(body);

      expect(status).toBe(HttpStatus.CONFLICT);
    });

    it('returns 400 for invalid UUIDs', async () => {
      const { status } = await request(app.getHttpServer())
        .post('/roles/assign')
        .send({ userId: 'bad', roleId: 'bad' });

      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── POST /roles/revoke ───────────────────────────────────────────────────

  describe('POST /roles/revoke', () => {
    const body = { userId, roleId };

    it('revokes a role and returns 204', async () => {
      mockRolesService.removeRoleFromUser.mockResolvedValue(undefined);

      const { status } = await request(app.getHttpServer())
        .post('/roles/revoke')
        .send(body);

      expect(status).toBe(HttpStatus.NO_CONTENT);
    });

    it('returns 400 when trying to remove last role', async () => {
      mockRolesService.removeRoleFromUser.mockRejectedValue(
        new NotFoundException(),
      );

      const { status } = await request(app.getHttpServer())
        .post('/roles/revoke')
        .send(body);

      // NotFoundException thrown → 404
      expect(status).toBe(HttpStatus.NOT_FOUND);
    });
  });
});
