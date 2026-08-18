import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  StreamableFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/request';
import { IngestService } from './ingest.service';
import { IngestQueryDto } from './dto/ingest-query.dto';
import { ReviewItemDto } from './dto/review-item.dto';
import { ApproveItemDto } from './dto/approve-item.dto';
import { JobMetaDto } from './dto/job-meta.dto';
import { UploadedFile as IUploadedFile } from './ingest.service';
import { buildDetectPrompt } from './vlm/real-vlm.provider';

@Controller('ingest')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TEACHER', 'ADMIN')
export class IngestController {
  constructor(private readonly service: IngestService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      // 与 nginx client_max_body_size 对齐（50MB）：超限由 multer 抛 413，前端有对应提示
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  upload(
    @UploadedFile() file: IUploadedFile,
    @CurrentUser() user: AuthenticatedUser,
    @Query('subjectId') subjectId?: string,
    @Query('displayName') displayName?: string,
  ) {
    return this.service.upload(file, user.id, subjectId, displayName);
  }

  // 步骤 2：自动框选题目（VLM 版面检测）
  @Post(':id/detect')
  detect(@Param('id') id: string, @Query('subjectId') subjectId?: string) {
    return this.service.detect(id, subjectId);
  }

  // AI 框选进度（前端进度条轮询）
  @Get(':id/detect-progress')
  detectProgress(@Param('id') id: string) {
    return this.service.getDetectProgress(id);
  }

  // 步骤 4：AI 识别题目内容（按框逐题识别）
  @Post(':id/recognize')
  recognize(@Param('id') id: string, @Query('subjectId') subjectId?: string) {
    return this.service.recognize(id, subjectId);
  }

  // 审阅台合并跨页截断题：前端上传拼接图 + 两个 item id
  @Post('items/merge')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  mergeItems(
    @UploadedFile() file: IUploadedFile,
    @Body('keepId') keepId?: string,
    @Body('mergedId') mergedId?: string,
  ) {
    if (!keepId || !mergedId) throw new BadRequestException('缺少合并参数');
    return this.service.mergeItems(keepId, mergedId, file);
  }

  // 步骤 3 辅助：人工新增一个题目框
  @Post('items')
  addBox(@Body() dto: { pageId: string; bbox: number[]; type?: string }) {
    return this.service.addBox(dto.pageId, dto.bbox, dto.type);
  }

  // 页面级图片框（与题目框解耦）：手绘一个图片区域，按需裁切后写入页面
  @Post('pages/:pageId/figures')
  addPageFigure(
    @Param('pageId') pageId: string,
    @Body() dto: { bbox: number[]; label?: string },
  ) {
    return this.service.addPageFigure(pageId, dto.bbox, dto.label);
  }

  // 页面级图片框：移动/缩放/删除后整体替换（重裁发生变化的项）
  @Patch('pages/:pageId/figures')
  updatePageFigures(
    @Param('pageId') pageId: string,
    @Body() dto: { figures: Array<{ bbox: number[]; cropId?: string; label?: string }> },
  ) {
    return this.service.updatePageFigures(pageId, dto.figures);
  }

  @Get()
  list(@Query() dto: IngestQueryDto) {
    return this.service.listJobs(dto);
  }

  // 页面原图（供前端框选编辑器展示）。需排在 :id 之前避免被捕获。
  @Get('pages/:pageId/image')
  async pageImage(@Param('pageId') pageId: string): Promise<StreamableFile> {
    const { buffer, mime } = await this.service.getPageImage(pageId);
    return new StreamableFile(buffer, { type: mime });
  }

  // 注意：suggestions 路由必须排在 :id 之前，否则会被 :id 捕获
  @Get('suggestions')
  suggestions(@Query('subjectId') subjectId?: string) {
    return this.service.listSuggestions(subjectId);
  }

  @Post('suggestions/:id/approve')
  approveSuggestion(@Param('id') id: string, @Query('parentId') parentId?: string) {
    return this.service.approveSuggestion(id, parentId);
  }

  @Post('suggestions/:id/reject')
  rejectSuggestion(@Param('id') id: string) {
    return this.service.rejectSuggestion(id);
  }

  // 调试用：返回当前实际发给 AI 的版面检测提示词
  @Get('detect-prompt')
  detectPrompt() {
    return { prompt: buildDetectPrompt() };
  }

  // 文件列表（试卷/作业本），供题库「按试卷/作业本」浏览。需排在 :id 之前。
  @Get('files')
  listFiles(@Query('sourceType') sourceType?: string) {
    return this.service.listFiles(sourceType as 'PAPER' | 'WORKBOOK' | undefined);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.getJob(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.deleteJob(id);
  }

  // 审阅台统一操作区：批量设置文件类型/名称/学科
  @Patch(':id/meta')
  updateMeta(@Param('id') id: string, @Body() dto: JobMetaDto) {
    return this.service.updateJobMeta(id, dto);
  }

  // 题库「编辑试卷」：改名（同步题目来源）+ 题目排序/大题修改
  @Patch(':id/paper-edit')
  editPaper(
    @Param('id') id: string,
    @Body()
    dto: {
      name?: string;
      items?: { id: string; number?: number | null; groupIndex?: number | null; groupTitle?: string | null }[];
    },
  ) {
    return this.service.editPaper(id, dto);
  }

  @Patch('items/:itemId')
  review(@Param('itemId') itemId: string, @Body() dto: ReviewItemDto) {
    return this.service.reviewItem(itemId, dto);
  }

  @Post('items/:itemId/approve')
  approve(
    @Param('itemId') itemId: string,
    @Body() dto: ApproveItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.approveItem(itemId, dto, user);
  }

  @Post('items/:itemId/reject')
  reject(@Param('itemId') itemId: string) {
    return this.service.rejectItem(itemId);
  }

  // 回退合并：把合并后的主题拆回合并前的两道题
  @Post('items/:itemId/unmerge')
  unmerge(@Param('itemId') itemId: string) {
    return this.service.unmergeItem(itemId);
  }

  // 审阅台单题重新识别（逐题重跑 VLM，复用已裁切 cropId）
  @Post('items/:itemId/recognize')
  recognizeItem(@Param('itemId') itemId: string, @Query('subjectId') subjectId?: string) {
    return this.service.recognizeItem(itemId, subjectId);
  }
}
