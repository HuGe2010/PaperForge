import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Patch,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('user:read')
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('role') role?: string,
  ) {
    return this.users.findAll({
      page: page ? +page : undefined,
      pageSize: pageSize ? +pageSize : undefined,
      keyword,
      role,
    });
  }

  @Get(':id')
  @RequirePermissions('user:read')
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Post()
  @RequirePermissions('user:create')
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('user:update')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('user:delete')
  remove(@Param('id') id: string) {
    return this.users.remove(id);
  }
}
