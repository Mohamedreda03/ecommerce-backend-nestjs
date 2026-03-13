import { BadRequestException, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

@Module({
  imports: [
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        storage: diskStorage({
          destination: (_req, _file, cb) => {
            const dir = path.resolve(
              config.get<string>('UPLOAD_DIR', './uploads'),
            );
            fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
          },
          filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            const safeExt = /^\.[a-z0-9]+$/.test(ext) ? ext : '';
            cb(null, `${uuidv4()}${safeExt}`);
          },
        }),
        fileFilter: (
          _req: Express.Request,
          file: Express.Multer.File,
          cb: (error: Error | null, acceptFile: boolean) => void,
        ) => {
          if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            cb(null, true);
          } else {
            cb(
              new BadRequestException(
                `Unsupported file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
              ),
              false,
            );
          }
        },
        limits: {
          fileSize: config.get<number>('MAX_FILE_SIZE_MB', 5) * 1024 * 1024,
        },
      }),
    }),
  ],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
