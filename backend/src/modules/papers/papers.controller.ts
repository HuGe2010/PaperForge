import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/request';
import { PapersService } from './papers.service';
import { CreatePaperDto, UpdatePaperDto } from './dto/create-paper.dto';
import { ComposeDto } from './dto/compose.dto';
import { AddQuestionDto, BatchAddQuestionsDto, ReorderDto, SetScoreDto } from './dto/paper-question.dto';

@Controller('papers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TEACHER', 'ADMIN')
export class PapersController {
  constructor(private readonly service: PapersService) {}

  @Post()
  create(@Body() dto: CreatePaperDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user.id);
  }

  @Get('compose')
  compose(@Query() dto: ComposeDto) {
    return this.service.compose(dto);
  }

  @Get()
  list(@Query() dto: { status?: string; page?: number; pageSize?: number }) {
    return this.service.list(dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePaperDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/questions')
  addQuestion(@Param('id') id: string, @Body() dto: AddQuestionDto) {
    return this.service.addQuestion(id, dto);
  }

  @Post(':id/questions/batch')
  batchAdd(@Param('id') id: string, @Body() dto: BatchAddQuestionsDto) {
    return this.service.batchAdd(id, dto);
  }

  @Delete(':id/questions/:pqId')
  removeQuestion(@Param('id') id: string, @Param('pqId') pqId: string) {
    return this.service.removeQuestion(id, pqId);
  }

  @Post(':id/questions/reorder')
  reorder(@Param('id') id: string, @Body() dto: ReorderDto) {
    return this.service.reorder(id, dto);
  }

  @Patch(':id/questions/:pqId')
  setScore(@Param('id') id: string, @Param('pqId') pqId: string, @Body() dto: SetScoreDto) {
    return this.service.setScore(id, pqId, dto);
  }
}
