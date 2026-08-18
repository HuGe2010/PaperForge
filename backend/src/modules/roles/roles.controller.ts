import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Put,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { SetPermissionsDto } from './dto/set-permissions.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

@Controller('roles')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('role:read')
  findAll() {
    return this.roles.findAll();
  }

  @Get(':id')
  @RequirePermissions('role:read')
  findOne(@Param('id') id: string) {
    return this.roles.findOne(id);
  }

  @Post()
  @RequirePermissions('role:create')
  create(@Body() dto: CreateRoleDto) {
    return this.roles.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('role:update')
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(id, dto);
  }

  @Put(':id/permissions')
  @RequirePermissions('role:update')
  setPermissions(@Param('id') id: string, @Body() dto: SetPermissionsDto) {
    return this.roles.setPermissions(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('role:delete')
  remove(@Param('id') id: string) {
    return this.roles.remove(id);
  }
}
