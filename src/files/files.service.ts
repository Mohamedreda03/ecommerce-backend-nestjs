import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FilesService {
  constructor(private readonly configService: ConfigService) {}

  private get uploadDir(): string {
    return path.resolve(
      this.configService.get<string>('UPLOAD_DIR', './uploads'),
    );
  }

  uploadFile(file: Express.Multer.File): { url: string } {
    return { url: `/uploads/${file.filename}` };
  }

  uploadFiles(files: Express.Multer.File[]): { urls: string[] } {
    return { urls: files.map((f) => `/uploads/${f.filename}`) };
  }

  deleteFile(filePath: string): void {
    // Sanitize: extract only the final filename component (prevents path traversal)
    const filename = path.basename(filePath);

    if (
      !filename ||
      filename === '.' ||
      filename === '..' ||
      filename.includes('\0')
    ) {
      throw new BadRequestException('Invalid file path');
    }

    const uploadDir = this.uploadDir;
    const resolvedPath = path.join(uploadDir, filename);

    // Double-check resolved path is strictly within the upload directory
    if (!resolvedPath.startsWith(uploadDir + path.sep)) {
      throw new BadRequestException('Invalid file path');
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new NotFoundException('File not found');
    }

    fs.unlinkSync(resolvedPath);
  }
}
