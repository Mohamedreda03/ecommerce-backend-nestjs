import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { FilesService } from './files.service';
import { DeleteFileDto } from './dto/delete-file.dto';
import { Permissions } from '../common/decorators/permissions.decorator';

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @Permissions('create:product')
  @UseInterceptors(FileInterceptor('file'))
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this.filesService.uploadFile(file);
  }

  @Post('upload-multiple')
  @Permissions('create:product')
  @UseInterceptors(FilesInterceptor('files', 10))
  uploadFiles(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) {
      throw new BadRequestException('No files provided');
    }
    return this.filesService.uploadFiles(files);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions('update:product')
  deleteFile(@Body() dto: DeleteFileDto) {
    this.filesService.deleteFile(dto.filePath);
  }
}
