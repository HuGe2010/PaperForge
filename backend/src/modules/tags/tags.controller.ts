import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TagsService } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';

@Controller('tags')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TagsController {
  constructor(private readonly service: TagsService) {}

  @Get()
  findAll(@Query('group') group?: string) {
    return this.service.findAll(group);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateTagDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: CreateTagDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
