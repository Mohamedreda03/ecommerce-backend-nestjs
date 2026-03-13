import {
  BadRequestException,
  HttpStatus,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import request from 'supertest';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const adminUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'admin@example.com',
  roles: ['ADMIN'],
  permissions: ['manage:all'],
};

// ─── Mock FilesService ────────────────────────────────────────────────────────

const mockFilesService = {
  uploadFile: jest.fn(),
  uploadFiles: jest.fn(),
  deleteFile: jest.fn(),
};

// ─── App builder ─────────────────────────────────────────────────────────────

function buildApp(): Promise<INestApplication> {
  return Test.createTestingModule({
    controllers: [FilesController],
    providers: [{ provide: FilesService, useValue: mockFilesService }],
    imports: [
      MulterModule.register({
        storage: memoryStorage(),
        limits: { fileSize: 10 * 1024 * 1024 },
      }),
    ],
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

describe('FilesController (integration)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    jest.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // ─── POST /files/upload ───────────────────────────────────────────────────

  describe('POST /files/upload', () => {
    it('returns 201 with URL on successful upload', async () => {
      mockFilesService.uploadFile.mockReturnValue({
        url: '/uploads/test-uuid.jpg',
      });

      const { status, body } = await request(app.getHttpServer())
        .post('/files/upload')
        .attach('file', Buffer.from('fake-image-data'), {
          filename: 'test.jpg',
          contentType: 'image/jpeg',
        });

      expect(status).toBe(HttpStatus.CREATED);
      expect(body.url).toBe('/uploads/test-uuid.jpg');
      expect(mockFilesService.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ originalname: 'test.jpg' }),
      );
    });

    it('returns 400 when no file is provided', async () => {
      const { status } = await request(app.getHttpServer()).post(
        '/files/upload',
      );
      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── POST /files/upload-multiple ─────────────────────────────────────────

  describe('POST /files/upload-multiple', () => {
    it('returns 201 with URLs array on successful batch upload', async () => {
      mockFilesService.uploadFiles.mockReturnValue({
        urls: ['/uploads/uuid1.jpg', '/uploads/uuid2.png'],
      });

      const { status, body } = await request(app.getHttpServer())
        .post('/files/upload-multiple')
        .attach('files', Buffer.from('image-1-data'), {
          filename: 'photo1.jpg',
          contentType: 'image/jpeg',
        })
        .attach('files', Buffer.from('image-2-data'), {
          filename: 'photo2.png',
          contentType: 'image/png',
        });

      expect(status).toBe(HttpStatus.CREATED);
      expect(body.urls).toHaveLength(2);
      expect(mockFilesService.uploadFiles).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ originalname: 'photo1.jpg' }),
        ]),
      );
    });

    it('returns 400 when no files are provided', async () => {
      const { status } = await request(app.getHttpServer()).post(
        '/files/upload-multiple',
      );
      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ─── DELETE /files ────────────────────────────────────────────────────────

  describe('DELETE /files', () => {
    it('returns 204 on successful deletion', async () => {
      mockFilesService.deleteFile.mockReturnValue(undefined);

      const { status } = await request(app.getHttpServer())
        .delete('/files')
        .send({ filePath: '/uploads/test-uuid.jpg' });

      expect(status).toBe(HttpStatus.NO_CONTENT);
      expect(mockFilesService.deleteFile).toHaveBeenCalledWith(
        '/uploads/test-uuid.jpg',
      );
    });

    it('returns 404 when file is not found', async () => {
      mockFilesService.deleteFile.mockImplementation(() => {
        throw new NotFoundException('File not found');
      });

      const { status } = await request(app.getHttpServer())
        .delete('/files')
        .send({ filePath: '/uploads/ghost.jpg' });

      expect(status).toBe(HttpStatus.NOT_FOUND);
    });

    it('returns 400 for invalid path (BadRequestException from service)', async () => {
      mockFilesService.deleteFile.mockImplementation(() => {
        throw new BadRequestException('Invalid file path');
      });

      const { status } = await request(app.getHttpServer())
        .delete('/files')
        .send({ filePath: '..' });

      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('returns 400 when filePath is missing from body', async () => {
      const { status } = await request(app.getHttpServer())
        .delete('/files')
        .send({});

      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });
});
