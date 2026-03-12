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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { Permissions } from '../common/decorators/permissions.decorator';

@ApiTags('roles')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  // ─── Permissions endpoint ────────────────────────────────────────────────

  @Get('permissions')
  @Permissions('read:role')
  @ApiOperation({ summary: 'List all available permissions' })
  getAllPermissions() {
    return this.rolesService.getAllPermissions();
  }

  // ─── Roles CRUD ──────────────────────────────────────────────────────────

  @Get('roles')
  @Permissions('read:role')
  @ApiOperation({ summary: 'List all roles with their permissions' })
  findAll() {
    return this.rolesService.findAll();
  }

  @Get('roles/:id')
  @Permissions('read:role')
  @ApiOperation({ summary: 'Get a role by id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.findById(id);
  }

  @Post('roles')
  @Permissions('create:role')
  @ApiOperation({ summary: 'Create a new role' })
  create(@Body() dto: CreateRoleDto) {
    return this.rolesService.create(dto);
  }

  @Patch('roles/:id')
  @Permissions('update:role')
  @ApiOperation({ summary: 'Update a role' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(id, dto);
  }

  @Delete('roles/:id')
  @Permissions('delete:role')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a custom role' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.delete(id);
  }

  // ─── Role assignment ─────────────────────────────────────────────────────

  @Post('roles/assign')
  @Permissions('update:user')
  @ApiOperation({ summary: 'Assign a role to a user' })
  assign(@Body() dto: AssignRoleDto) {
    return this.rolesService.assignRoleToUser(dto);
  }

  @Post('roles/revoke')
  @Permissions('update:user')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a role from a user' })
  revoke(@Body() dto: AssignRoleDto) {
    return this.rolesService.removeRoleFromUser(dto);
  }
}
