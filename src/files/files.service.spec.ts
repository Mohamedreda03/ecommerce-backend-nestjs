import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { FilesService } from './files.service';

jest.mock('fs');

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockConfigService = {
  get: jest.fn().mockReturnValue('./uploads'),
};

function buildModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      FilesService,
      { provide: ConfigService, useValue: mockConfigService },
    ],
  }).compile();
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockFile = {
  fieldname: 'file',
  originalname: 'test-image.jpg',
  encoding: '7bit',
  mimetype: 'image/jpeg',
  filename: 'abc-uuid.jpg',
  path: '/uploads/abc-uuid.jpg',
  size: 1024,
} as Express.Multer.File;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FilesService', () => {
  let service: FilesService;
  const uploadDir = path.resolve('./uploads');

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockReturnValue('./uploads');
    const module = await buildModule();
    service = module.get<FilesService>(FilesService);
  });

  // ─── uploadFile ───────────────────────────────────────────────────────────

  describe('uploadFile', () => {
    it('returns a URL built from the file filename', () => {
      const result = service.uploadFile(mockFile);
      expect(result).toEqual({ url: '/uploads/abc-uuid.jpg' });
    });

    it('uses file.filename in the URL path', () => {
      const file = {
        ...mockFile,
        filename: 'custom-uuid.png',
      } as Express.Multer.File;
      const result = service.uploadFile(file);
      expect(result.url).toBe('/uploads/custom-uuid.png');
    });
  });

  // ─── uploadFiles ──────────────────────────────────────────────────────────

  describe('uploadFiles', () => {
    it('returns URLs for all uploaded files', () => {
      const files = [
        { ...mockFile, filename: 'file1-uuid.jpg' },
        { ...mockFile, filename: 'file2-uuid.png' },
      ] as Express.Multer.File[];

      const result = service.uploadFiles(files);

      expect(result.urls).toHaveLength(2);
      expect(result.urls[0]).toBe('/uploads/file1-uuid.jpg');
      expect(result.urls[1]).toBe('/uploads/file2-uuid.png');
    });

    it('returns empty array for empty input', () => {
      const result = service.uploadFiles([]);
      expect(result.urls).toHaveLength(0);
    });
  });

  // ─── deleteFile ───────────────────────────────────────────────────────────

  describe('deleteFile', () => {
    const mockExistsSync = fs.existsSync as jest.MockedFunction<
      typeof fs.existsSync
    >;
    const mockUnlinkSync = fs.unlinkSync as jest.MockedFunction<
      typeof fs.unlinkSync
    >;

    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
      mockUnlinkSync.mockImplementation(() => undefined);
    });

    it('deletes a file given a /uploads/-prefixed URL', () => {
      service.deleteFile('/uploads/abc-uuid.jpg');

      expect(mockUnlinkSync).toHaveBeenCalledWith(
        path.join(uploadDir, 'abc-uuid.jpg'),
      );
    });

    it('deletes a file given just the filename', () => {
      service.deleteFile('abc-uuid.jpg');

      expect(mockUnlinkSync).toHaveBeenCalledWith(
        path.join(uploadDir, 'abc-uuid.jpg'),
      );
    });

    it('throws NotFoundException when file does not exist on disk', () => {
      mockExistsSync.mockReturnValue(false);

      expect(() => service.deleteFile('/uploads/missing.jpg')).toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException for empty filePath', () => {
      expect(() => service.deleteFile('')).toThrow(BadRequestException);
    });

    it('throws BadRequestException for "." filePath', () => {
      expect(() => service.deleteFile('.')).toThrow(BadRequestException);
    });

    it('throws BadRequestException for ".." filePath', () => {
      expect(() => service.deleteFile('..')).toThrow(BadRequestException);
    });

    it('strips directory components from path traversal attempts', () => {
      // path.basename strips traversal — only 'passwd' remains, which won't exist
      mockExistsSync.mockReturnValue(false);

      expect(() => service.deleteFile('../../etc/passwd')).toThrow(
        NotFoundException,
      );
      // Confirm it looked for 'passwd' inside the upload dir, not the traversal path
      const [[calledPath]] = mockExistsSync.mock.calls;
      expect(calledPath).toBe(path.join(uploadDir, 'passwd'));
    });

    it('does not call unlinkSync when file is not found', () => {
      mockExistsSync.mockReturnValue(false);

      try {
        service.deleteFile('/uploads/ghost.jpg');
      } catch {
        // expected
      }

      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });
  });
});
