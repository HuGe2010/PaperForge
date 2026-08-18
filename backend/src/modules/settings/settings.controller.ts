import { Controller, Get, Put, Param, Body, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SetGroupDto } from './dto/set-group.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions('setting:read')
  all() {
    return this.settings.getAllView();
  }

  @Get(':group')
  @RequirePermissions('setting:read')
  group(@Param('group') group: string) {
    return this.settings.getGroupView(group);
  }

  @Put(':group')
  @RequirePermissions('setting:update')
  set(
    @Param('group') group: string,
    @Body() dto: SetGroupDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.settings.setGroup(group, dto.items, userId);
  }
}
