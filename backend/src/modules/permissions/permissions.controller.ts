import { Controller, Get, UseGuards } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

@Controller('permissions')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class PermissionsController {
  constructor(private readonly perms: PermissionsService) {}

  @Get()
  @RequirePermissions('role:read')
  findAll() {
    return this.perms.findAll();
  }

  @Get('groups')
  @RequirePermissions('role:read')
  groups() {
    return this.perms.findByGroup();
  }
}
