import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { KnowledgeService } from './knowledge.service';
import { CreateKnowledgePointDto } from './dto/create-knowledge.dto';

@Controller('knowledge-points')
@UseGuards(JwtAuthGuard, RolesGuard)
export class KnowledgeController {
  constructor(private readonly service: KnowledgeService) {}

  @Get('tree')
  findTree(@Query('subjectId') subjectId: string) {
    if (!subjectId) throw new BadRequestException('subjectId 必填');
    return this.service.findTree(subjectId);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateKnowledgePointDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: CreateKnowledgePointDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
