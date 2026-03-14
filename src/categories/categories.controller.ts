import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CacheInterceptor } from '../common/interceptors/cache.interceptor';
import { CacheTTL } from '../common/decorators/cache-ttl.decorator';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Public()
  @Get()
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300)
  @ApiOperation({ summary: 'List active categories (storefront)' })
  findAll() {
    return this.categoriesService.findAll(false);
  }

  @Public()
  @Get('tree')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300)
  @ApiOperation({ summary: 'Get category tree (storefront)' })
  findTree() {
    return this.categoriesService.findTree();
  }

  @Get('admin')
  @Permissions('read:category')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all categories including inactive (admin)' })
  findAllAdmin() {
    return this.categoriesService.findAll(true);
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Get a category by slug (storefront)' })
  findBySlug(@Param('slug') slug: string) {
    return this.categoriesService.findBySlug(slug);
  }

  @Post()
  @Permissions('create:category')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a category (admin)' })
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  @Patch(':id')
  @Permissions('update:category')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a category (admin)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(id, dto);
  }

  @Delete(':id')
  @Permissions('delete:category')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a category (admin)' })
  @ApiQuery({ name: 'force', required: false, type: Boolean })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('force') force?: string,
  ) {
    return this.categoriesService.delete(id, force === 'true');
  }
}
