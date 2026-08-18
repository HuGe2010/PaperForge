import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/request';
import { WorkbookService } from './workbook.service';
import {
  CreateWorkbookDto,
  UpdateWorkbookDto,
  CreateSectionDto,
  UpdateSectionDto,
  MoveSectionDto,
  AssignQuestionDto,
  UnassignQuestionDto,
} from './dto/workbook.dto';

/** 作业本是教师侧备课资产，读写一律限定 TEACHER / ADMIN（学生不应看到题库组织结构） */
@Controller('workbooks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TEACHER', 'ADMIN')
export class WorkbookController {
  constructor(private readonly service: WorkbookService) {}

  @Post()
  create(@Body() dto: CreateWorkbookDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWorkbookDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  /** 作业本内题目（含 workbookSectionId，前端按章节 id 分组，不依赖名称路径） */
  @Get(':id/questions')
  questions(@Param('id') id: string) {
    return this.service.listQuestions(id);
  }

  // ---------------- 章节树 ----------------

  @Post(':id/sections')
  createSection(@Param('id') id: string, @Body() dto: CreateSectionDto) {
    return this.service.createSection(id, dto);
  }

  @Patch(':id/sections/:sectionId')
  updateSection(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: UpdateSectionDto,
  ) {
    return this.service.updateSection(id, sectionId, dto);
  }

  /** 同级上移 / 下移 */
  @Post(':id/sections/:sectionId/move')
  moveSection(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: MoveSectionDto,
  ) {
    return this.service.moveSection(id, sectionId, dto.direction);
  }

  /** 删除前的影响面预览（会连带删除几个子章节、移出多少题） */
  @Get(':id/sections/:sectionId/remove-preview')
  previewRemoveSection(@Param('id') id: string, @Param('sectionId') sectionId: string) {
    return this.service.previewRemoveSection(id, sectionId);
  }

  @Delete(':id/sections/:sectionId')
  removeSection(@Param('id') id: string, @Param('sectionId') sectionId: string) {
    return this.service.removeSection(id, sectionId);
  }

  // ---------------- 题目归属 ----------------

  /** 归入章节（sectionId 空 = 作业本根）；同一接口用于换章节 / 从别的作业本移过来 */
  @Post(':id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignQuestionDto) {
    return this.service.assignQuestions(id, dto.questionIds, dto.sectionId);
  }

  /** 移出作业本（题目回到题库，不删题） */
  @Post(':id/unassign')
  unassign(@Param('id') id: string, @Body() dto: UnassignQuestionDto) {
    return this.service.unassignQuestions(id, dto.questionIds);
  }
}
