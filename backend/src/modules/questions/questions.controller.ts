import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { QuestionsService } from './questions.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { SetQuestionImagesDto } from './dto/set-question-images.dto';
import { QueryQuestionDto } from './dto/query-question.dto';
import { BatchDeleteQuestionsDto } from './dto/batch-delete-questions.dto';
import { AddToPaperDto } from './dto/add-to-paper.dto';
import { RemoveFromPaperDto } from './dto/remove-from-paper.dto';
import { AuthenticatedUser } from '../../common/types/request';

@Controller('questions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QuestionsController {
  constructor(private readonly service: QuestionsService) {}

  @Get()
  list(@Query() dto: QueryQuestionDto) {
    return this.service.list(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // 来源整页原图（需在 :id 具体路由之后声明以避免歧义，但本路由含固定段 source-image，不会被 :id 捕获）
  @Get(':id/source-image')
  sourceImage(@Param('id') id: string): Promise<StreamableFile> {
    return this.service.getSourceImage(id).then(({ buffer, mime }) => new StreamableFile(buffer, { type: mime }));
  }

  // 题内图片（content.images[].cropId → 读取 UPLOAD_DIR/crops/{cropId}.png）
  // 公开访问（<img src> 无法带 token；cropId 为不可猜测的 UUID）
  @Public()
  @Get('figure/:cropId')
  figure(@Param('cropId') cropId: string): Promise<StreamableFile> {
    return this.service.getFigureImage(cropId).then(({ buffer, mime }) => new StreamableFile(buffer, { type: mime }));
  }

  // 题图：本地上传（题库「+图片」）
  @Post('figure-upload')
  @Roles('TEACHER', 'ADMIN')
  @UseInterceptors(FileInterceptor('file'))
  figureUpload(@UploadedFile() file: any) {
    return this.service.uploadFigure(file);
  }

  // 题图：从试卷页框选裁切（题库「+图片」→ 从 PDF/图片页选择）
  @Post('figure-from-page')
  @Roles('TEACHER', 'ADMIN')
  figureFromPage(@Body() dto: { pageId: string; bbox: number[] }) {
    return this.service.figureFromPage(dto);
  }

  @Post()
  @Roles('TEACHER', 'ADMIN')
  create(@Body() dto: CreateQuestionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user.id);
  }

  @Put(':id')
  @Roles('TEACHER', 'ADMIN')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateQuestionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('TEACHER', 'ADMIN')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  // 批量删除题目（TEACHER/ADMIN）；受考试作答引用的题目会被跳过并在返回中说明
  @Post('batch-delete')
  @Roles('TEACHER', 'ADMIN')
  batchRemove(@Body() dto: BatchDeleteQuestionsDto) {
    return this.service.batchRemove(dto.ids);
  }

  // 试卷侧边栏「添加题目到试卷」：把题库已有题目追加归属到指定试卷（写 sourcePapers，去重）
  @Post('add-to-paper')
  @Roles('TEACHER', 'ADMIN')
  addToPaper(@Body() dto: AddToPaperDto) {
    return this.service.addToPaper(dto.paperName, dto.questionIds);
  }

  // 试卷侧边栏「从小卷移除题目」：把题目的 sourcePapers 剔除指定试卷名（不删题，保留其它试卷归属）
  @Post('remove-from-paper')
  @Roles('TEACHER', 'ADMIN')
  removeFromPaper(@Body() dto: RemoveFromPaperDto) {
    return this.service.removeFromPaper(dto.paperName, dto.questionIds);
  }

  // 题内图片原子更新（采用已框题图 / 上传 / 从页面裁），供题库详情页与抽屉复用
  @Patch(':id/images')
  @Roles('TEACHER', 'ADMIN')
  setImages(@Param('id') id: string, @Body() dto: SetQuestionImagesDto) {
    return this.service.setImages(id, dto.images);
  }

  // 入库后统一触发 AI 解答（解析 + 步骤），不耦合录入流程
  @Post(':id/solve')
  @Roles('TEACHER', 'ADMIN')
  solve(@Param('id') id: string) {
    return this.service.solveQuestion(id);
  }

  // ---------------- 题目查重（人工） ----------------
  @Get('dedup/groups')
  dedupGroups() {
    return this.service.scanDuplicateGroups();
  }

  @Get('dedup/ignored')
  dedupIgnored() {
    return this.service.listIgnoredGroups();
  }

  @Get('dedup/count')
  dedupCount() {
    return this.service.countDedupGroups();
  }

  // 回填存量题目语义向量（需配置 LLM 密钥）：返回 {total, generated}
  @Post('dedup/backfill')
  @Roles('TEACHER', 'ADMIN')
  dedupBackfill() {
    return this.service.backfillEmbeddings();
  }

  @Post('dedup/ignore')
  @Roles('TEACHER', 'ADMIN')
  ignoreGroup(@Body() dto: { questionIds: string[] }) {
    return this.service.ignoreGroup(dto.questionIds);
  }

  @Post('dedup/ignore-pair')
  @Roles('TEACHER', 'ADMIN')
  ignorePair(@Body() dto: { a: string; b: string }) {
    return this.service.ignorePair(dto.a, dto.b);
  }

  @Delete('dedup/ignore/:id')
  @Roles('TEACHER', 'ADMIN')
  unignore(@Param('id') id: string) {
    return this.service.unignore(id);
  }

  @Post('dedup/merge')
  @Roles('TEACHER', 'ADMIN')
  mergeQuestions(
    @Body() dto: { keptId: string; absorbedIds: string[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.mergeQuestions(dto, user.id);
  }

  @Post('dedup/merge/:id/undo')
  @Roles('TEACHER', 'ADMIN')
  undoMerge(@Param('id') id: string) {
    return this.service.undoMerge(id);
  }

  // 归档页：按被吸收题 id 反查并撤销合并
  @Post('dedup/merge-by-question/:id/undo')
  @Roles('TEACHER', 'ADMIN')
  undoMergeByQuestion(@Param('id') id: string) {
    return this.service.undoMergeByQuestion(id);
  }

  // 详情页：某保留题名下「合并来的题目」（实时取数，撤销合并后自动消失）
  @Get('dedup/merged-questions/:keptId')
  @Roles('TEACHER', 'ADMIN')
  mergedQuestions(@Param('keptId') keptId: string) {
    return this.service.listMergedQuestions(keptId);
  }

  // 归档页：恢复（取消归档）
  @Post(':id/restore')
  @Roles('TEACHER', 'ADMIN')
  restoreQuestion(@Param('id') id: string) {
    return this.service.restoreQuestion(id);
  }
}
