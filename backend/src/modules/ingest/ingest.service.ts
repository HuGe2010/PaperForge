import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Prisma, QuestionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QuestionsService } from '../questions/questions.service';
import { VlmService } from './vlm/vlm.service';
import { cropImageByBbox, isRasterImage, isPdf, type BBox } from './image-crop.util';
import { IngestQueryDto } from './dto/ingest-query.dto';
import { ReviewItemDto } from './dto/review-item.dto';
import { ApproveItemDto } from './dto/approve-item.dto';
import { AuthenticatedUser } from '../../common/types/request';
import { ensureMathDelimiters } from '../../common/tex.util';

/** 上传文件的最小结构（避开缺失的 @types/multer 依赖） */
export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer?: Buffer;
}

// 上传根目录：容器内由 compose 注入 UPLOAD_DIR=/app/uploads（对应挂载卷 ./data/uploads），
// 本地开发未设置时回退到 process.cwd()/uploads，保持原有行为。
const UPLOAD_DIR = path.join(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'), 'ingest');

/** 全部题型集合（校验 AI 返回的小题题型用） */
const QUESTION_TYPES_SET = new Set<QuestionType>([
  'SINGLE_CHOICE',
  'MULTIPLE_CHOICE',
  'TRUE_FALSE',
  'FILL_BLANK',
  'SHORT_ANSWER',
  'ESSAY',
  'MATERIAL',
  'READING_COMPREHENSION',
]);

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  // AI 框选进度（内存态）：jobId -> { done, total, pageIndex }，供前端轮询显示进度条
  private readonly detectProgress = new Map<string, { done: number; total: number; pageIndex: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly questions: QuestionsService,
    private readonly vlm: VlmService,
  ) {}

  // ---------------- 上传（步骤 1） ----------------
  async upload(file: UploadedFile, userId?: string, subjectId?: string, displayName?: string) {
    if (!file || !file.buffer) throw new BadRequestException('未收到文件');
    const isPdfFile = file.mimetype === 'application/pdf';
    const jobId = randomUUID();
    await fs.mkdir(UPLOAD_DIR, { recursive: true });

    // 优先使用前端传入的 displayName（浏览器 File.name 为正确中文，规避 multer originalname 偶尔解码异常）
    const fileName = (displayName && displayName.trim()) || file.originalname || '未命名文件';

    // PDF：先存 PDF 原文（英文 id 命名，避免中文文件名），再逐页转成图片，
    // 每页一张 ingestPage，后续框选/裁切/识别全部走图片逻辑。
    if (isPdfFile) {
      const pdfDir = path.join(UPLOAD_DIR, 'pdfs');
      await fs.mkdir(pdfDir, { recursive: true });
      const pdfPath = path.join(pdfDir, `${jobId}.pdf`);
      await fs.writeFile(pdfPath, file.buffer);

      const pageImages = await this.pdfToPageImages(jobId, file.buffer);
      if (!pageImages.length) {
        throw new BadRequestException('PDF 未解析出任何页面，请检查文件是否损坏');
      }

      const job = await this.prisma.ingestJob.create({
        data: {
          id: jobId,
          fileName,
          fileType: 'pdf',
          fileSize: file.size,
          status: 'UPLOADED',
          createdById: userId,
          pageCount: pageImages.length,
          pages: {
            create: pageImages.map((p, i) => ({ pageNumber: i + 1, imagePath: p.path })),
          },
        },
      });
      this.logger.log(
        `IngestJob ${jobId} 已创建 (pdf, ${pageImages.length} 页)` +
          (subjectId ? ` subject=${subjectId}` : ''),
      );
      return job;
    }

    // 图片：原样保存为单页
    const safeName = file.originalname.replace(/[^\w.\-]/g, '_');
    const storedPath = path.join(UPLOAD_DIR, `${jobId}-${safeName}`);
    await fs.writeFile(storedPath, file.buffer);

    const job = await this.prisma.ingestJob.create({
      data: {
        id: jobId,
        fileName,
        fileType: 'image',
        fileSize: file.size,
        status: 'UPLOADED',
        pages: { create: { pageNumber: 1, imagePath: storedPath } },
      },
    });
    this.logger.log(`IngestJob ${jobId} 已创建 (image)` + (subjectId ? ` subject=${subjectId}` : ''));
    return job;
  }

  /**
   * 把 PDF 逐页转成 PNG：调用本地 OCR 容器（FastAPI + PyMuPDF）的 /pdf-to-images，
   * 每页保存到 UPLOAD_DIR/pages/{jobId}-p{NN}.png（英文 id 命名），返回 [{path}]。
   * OCR 容器不可用时抛出 BadRequestException（上传失败，提示稍后重试）。
   */
  private async pdfToPageImages(jobId: string, pdfBuffer: Buffer): Promise<{ path: string }[]> {
    const baseUrl = process.env.OCR_SERVICE_URL || 'http://localhost:8000';
    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(pdfBuffer)], { type: 'application/pdf' }), `${jobId}.pdf`);
    form.append('dpi', '150');

    let resp: Response;
    try {
      resp = await fetch(`${baseUrl}/pdf-to-images`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(180_000), // 大 PDF 逐页渲染耗时，放宽到 3 分钟
      });
    } catch (e: any) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        throw new BadRequestException('PDF 转图超时（>180s），请尝试页数较少的 PDF');
      }
      throw new BadRequestException(`PDF 转图服务不可用（${baseUrl}）：${e?.message || e}`);
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new BadRequestException(`PDF 转图失败 ${resp.status}: ${errText.slice(0, 300)}`);
    }

    const data: any = await resp.json();
    const pagesDir = path.join(UPLOAD_DIR, 'pages');
    await fs.mkdir(pagesDir, { recursive: true });

    const results: { path: string }[] = [];
    for (const p of data?.pages || []) {
      if (!p || typeof p.image !== 'string') continue;
      const imagePath = path.join(pagesDir, `${jobId}-p${String(p.page).padStart(2, '0')}.png`);
      await fs.writeFile(imagePath, Buffer.from(p.image, 'base64'));
      results.push({ path: imagePath });
    }
    return results;
  }

  // ---------------- 自动框选（步骤 2：VLM 版面检测） ----------------
  async detect(jobId: string, subjectId?: string) {
    const job = await this.prisma.ingestJob.findUnique({
      where: { id: jobId },
      include: { pages: true },
    });
    if (!job) throw new NotFoundException('录入任务不存在');
    // 允许从「已上传 / 裁题中 / 待审阅」重新框选：识别后若想重选框，可回退重来
    if (!['UPLOADED', 'SEGMENTING', 'REVIEWING'].includes(job.status)) {
      throw new BadRequestException(`当前状态(${job.status})不可重新框选`);
    }
    await this.prisma.ingestJob.update({ where: { id: jobId }, data: { status: 'SEGMENTING' } });
    // 仪表盘 AI 工作进度：记录框选任务（持久化）
    const task = await this.prisma.aiTaskLog.create({
      data: { type: 'detect', title: job.fileName, status: 'RUNNING', done: 0, total: job.pages.length, jobId },
    });
    const taskUpdate = (data: Partial<{ done: number; percent: number; message: string; status: string; total: number }>) =>
      this.prisma.aiTaskLog
        .update({ where: { id: task.id }, data: data as any })
        .catch(() => undefined);

    // 框选前清空未定稿（未入库/未拒绝）的检测框，保证可重复框选且不残留旧框。
    // 不再跳过已合并项：重新框选 = 重来一遍，未定稿的合并项（含主项与被合并项）一并清除，
    // 避免出现「被合并项 mergedIntoId 指向已删除主项」的孤儿。已入库(APPROVED)的框保留。
    await this.prisma.ocrItem.deleteMany({
      where: { jobId, status: { in: ['DETECTED', 'PENDING_REVIEW'] } },
    });

    let index = 0;
    let rawReply = '';
    let pageDone = 0;
    const totalPages = job.pages.length;
    try {
      for (const page of job.pages) {
        pageDone += 1;
        this.detectProgress.set(jobId, { done: pageDone - 1, total: totalPages, pageIndex: page.pageNumber ?? pageDone });
        await taskUpdate({ done: pageDone - 1, percent: Math.round(((pageDone - 1) / totalPages) * 100), message: `框选中 ${pageDone - 1}/${totalPages} 页` });
        // 转图后 page.imagePath 已是 PNG；PDF 原文仅归档，不直接送 OCR
        const result = await this.vlm.detect({
          imagePath: page.imagePath,
          mimeType: isPdf(page.imagePath) ? 'application/pdf' : 'image/png',
        });
        this.detectProgress.set(jobId, { done: pageDone, total: totalPages, pageIndex: page.pageNumber ?? pageDone });
        await taskUpdate({ done: pageDone, percent: Math.round((pageDone / totalPages) * 100), message: `框选中 ${pageDone}/${totalPages} 页` });
        if (result.raw) rawReply = result.raw;
        if (result.paperName) {
          await this.prisma.ingestPage.update({
            where: { id: page.id },
            data: { paperName: result.paperName },
          });
        }
        let groupIndex = 0;
        let groupTitle: string | undefined;
        for (const box of result.boxes) {
          // 大题标题框（number=null 且带 title）：不建题，作为分组标记，更新当前大题号/标题
          if (box.title && box.number === null) {
            groupIndex += 1;
            groupTitle = box.title;
            continue;
          }
          index += 1;
          // 图片不绑定题目：AI/OCR 识别的图片区域统一写入页面级 page.figures（见下），此处不再写 item.figures
          await this.prisma.ocrItem.create({
            data: {
              jobId,
              pageId: page.id,
              index,
              status: 'DETECTED',
              type: box.type,
              confidence: box.confidence,
              bbox: (box.bbox as unknown as Prisma.InputJsonValue) ?? undefined,
              sourceImagePath: page.imagePath,
              paperName: result.paperName ?? undefined,
              number: box.number ?? index,
              groupIndex: groupIndex || undefined,
              groupTitle: groupTitle || undefined,
            },
          });
        }

        // 页面级题图：AI/OCR 识别出的图片区域与手绘图片框同源，框选阶段即按 bbox 裁出并追加到
        // IngestPage.figures，审阅台的「采用已框题图」池即可把它指派给任意大题/小题。
        const pageFigures = result.pageFigures ?? [];
        if (pageFigures.length && isRasterImage(page.imagePath)) {
          const cropped = await this.saveFigures(
            page.imagePath,
            pageFigures.map((f) => ({ bbox: f.bbox, label: f.label || '题内图片', source: 'ai' })),
          );
          if (cropped.length) {
            // 重新框选时替换上一轮 AI 图（source=ai），人工手绘的图片框保留
            const kept = ((Array.isArray(page.figures) ? page.figures : []) as unknown as any[]).filter(
              (f) => f?.source !== 'ai',
            );
            await this.prisma.ingestPage.update({
              where: { id: page.id },
              data: { figures: [...kept, ...cropped] as unknown as Prisma.InputJsonValue },
            });
          }
        }
      }
    } catch (e) {
      await taskUpdate({ status: 'FAILED', message: (e as Error).message?.slice(0, 200) ?? '框选失败' });
      throw e;
    }
    await this.prisma.ingestJob.update({
      where: { id: jobId },
      data: { status: 'SEGMENTING', pageCount: job.pages.length },
    });
    await taskUpdate({ status: 'DONE', percent: 100, done: totalPages, total: totalPages, message: `框选完成，共 ${index} 题` });
    this.logger.log(
      `[VLM detect] job=${jobId} pages=${job.pages.length} boxes=${index}` +
        (rawReply ? `\n${rawReply.slice(0, 2000)}` : ''),
    );
    return { job: await this.getJob(jobId), rawReply };
  }

  // AI 框选进度（供前端进度条轮询）
  getDetectProgress(jobId: string) {
    return this.detectProgress.get(jobId) ?? { done: 0, total: 0, pageIndex: 0 };
  }

  // ---------------- 审阅台合并跨页截断题 ----------------
  // 跨页题目被框成两个 item：前端把两页的题区图上下拼接成一张图上传。
  // 主项记录合并前信息（sourceImagePath/bbox）+ 被合并项标记 mergedIntoId（不删除），
  // 这样随时可「回退合并」拆回两道题。
  async mergeItems(keepId: string, mergedId: string, file?: UploadedFile) {
    const [keep, merged] = await Promise.all([
      this.prisma.ocrItem.findUnique({ where: { id: keepId } }),
      this.prisma.ocrItem.findUnique({ where: { id: mergedId } }),
    ]);
    if (!keep || !merged) throw new NotFoundException('题目项不存在');
    if (keep.jobId !== merged.jobId) throw new BadRequestException('只能合并同一文件内的题目');
    if (keep.status === 'APPROVED' || merged.status === 'APPROVED') {
      throw new BadRequestException('已入库的题目不可合并，请到题库操作');
    }
    if (merged.mergedIntoId) throw new BadRequestException('该题已被合并过，请先回退再合并');

    let mergedImagePath = keep.sourceImagePath;
    if (file?.buffer?.length) {
      const dir = path.join(UPLOAD_DIR, 'crops');
      await fs.mkdir(dir, { recursive: true });
      mergedImagePath = path.join(dir, `merged-${randomUUID()}.png`);
      await fs.writeFile(mergedImagePath, file.buffer);
    }

    // 内容：主项无识别内容而合并项有（如先识别了下半截），沿用合并项的；两边都有则保留主项（避免错误拼接语义）
    let content = keep.content;
    if (!content && merged.content) content = merged.content;

    await this.prisma.ocrItem.update({
      where: { id: keep.id },
      data: {
        sourceImagePath: mergedImagePath,
        bbox: Prisma.DbNull, // 拼接图即完整题目，后续识别整图
        mergedFromImagePath: keep.sourceImagePath, // 记录合并前，供回退
        mergedFromBbox: keep.bbox ?? Prisma.DbNull,
        content: content === keep.content ? undefined : ((content as Prisma.InputJsonValue) ?? undefined),
      },
    });
    // 被合并项不删除：标记并入主项，回退时拆开
    await this.prisma.ocrItem.update({
      where: { id: merged.id },
      data: { mergedIntoId: keep.id },
    });

    return this.getJob(keep.jobId);
  }

  // ---------------- 回退合并：主项恢复合并前，拆回被合并项 ----------------
  async unmergeItem(itemId: string) {
    const item = await this.prisma.ocrItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('题目项不存在');
    if (!item.mergedFromImagePath) throw new BadRequestException('该题未被合并过，无法回退');

    await this.prisma.ocrItem.update({
      where: { id: item.id },
      data: {
        sourceImagePath: item.mergedFromImagePath,
        bbox: item.mergedFromBbox ? ((item.mergedFromBbox as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull) : Prisma.DbNull,
        mergedFromImagePath: null,
        mergedFromBbox: Prisma.DbNull,
      },
    });
    await this.prisma.ocrItem.updateMany({
      where: { mergedIntoId: item.id },
      data: { mergedIntoId: null },
    });

    return this.getJob(item.jobId);
  }

  // ---------------- AI 识别题目内容（步骤 4：按框逐题识别） ----------------
  async recognize(jobId: string, subjectId?: string) {
    const job = await this.prisma.ingestJob.findUnique({
      where: { id: jobId },
      include: {
        pages: true,
        items: { where: { status: { in: ['DETECTED', 'PENDING_REVIEW'] }, mergedIntoId: null }, orderBy: { index: 'asc' } },
      },
    });
    if (!job) throw new NotFoundException('录入任务不存在');
    const detected = job.items;
    if (!detected.length) {
      throw new BadRequestException('没有待识别的框选区域，请先执行「自动框选」');
    }
    await this.prisma.ingestJob.update({ where: { id: jobId }, data: { status: 'RECOGNIZING' } });
    // 仪表盘 AI 工作进度：记录识别任务（持久化，可追溯）
    const task = await this.prisma.aiTaskLog.create({
      data: { type: 'recognize', title: job.fileName, status: 'RUNNING', done: 0, total: detected.length, jobId },
    });
    const taskUpdate = (data: Partial<{ done: number; percent: number; message: string; status: string; total: number }>) =>
      this.prisma.aiTaskLog
        .update({ where: { id: task.id }, data: data as any })
        .catch(() => undefined);

    // 加载学科名单：用于把 VLM 识别出的学科名映射成真实 subjectId（AI 命中优先，未命中回退任务级 subjectId）
    const subjects = await this.prisma.subject.findMany({ select: { id: true, name: true, code: true } });
    const subjectNames = subjects.map((s) => s.name);
    const suggestionNames = new Set<string>();
    const skipped: number[] = []; // 题型始终无法确定（人工未指定且 AI 未识别出）的题
    const aiAssignedTypes: { index: number; type: QuestionType }[] = []; // AI 首次判断的题型（前端提示用）
    let recognizedCount = 0;
    try {
      for (const page of job.pages) {
        const pageItems = detected.filter((i) => i.pageId === page.id);
        for (const item of pageItems) {
          // 题型：已由人工指定则按该题型约束提取内容；首次识别（未指定）让 VLM 自行判断题型
          const type = (item.type as QuestionType | null | undefined) ?? undefined;
          const bbox = (item.bbox as unknown as BBox) ?? undefined;
          // 光栅图：按框裁出单题后独立识别，避免模型读到整页而只认出第一题。
          // 裁切 id 持久化，入库后即作为题目的唯一 id。PDF 无法单页裁切，回退为整页 + bbox 提示。
          let sentImagePath = page.imagePath;
          let sentBbox: BBox | undefined = bbox;
          let cropId: string | undefined = item.cropId ?? undefined;
          let cropImagePath: string | undefined = item.cropImagePath ?? undefined;

          if (bbox && isRasterImage(page.imagePath)) {
            cropId = item.cropId ?? randomUUID();
            cropImagePath = path.join(UPLOAD_DIR, 'crops', `${cropId}.png`);
            try {
              await cropImageByBbox(page.imagePath, bbox, cropImagePath);
              sentImagePath = cropImagePath;
              sentBbox = undefined; // 已是单题图，无需再给 bbox 提示
              await this.prisma.ocrItem.update({
                where: { id: item.id },
                data: { cropId, cropImagePath },
              });
            } catch (e) {
              this.logger.warn(
                `[recognize] 单题裁切失败，回退整页识别 item=${item.id}: ${(e as Error).message}`,
              );
              sentImagePath = page.imagePath;
              sentBbox = bbox;
            }
          }

          const result = await this.vlm.recognize({
            imagePath: sentImagePath,
            mimeType: isPdf(page.imagePath) ? 'application/pdf' : 'image/png',
            subjectId,
            subjectNames,
            type, // 为空时不传 typeHint → 让 VLM 自行判断题型
            bbox: sentBbox,
          });
          const dq = result.items[0];
          recognizedCount += 1;
          await taskUpdate({ done: recognizedCount, percent: Math.round((recognizedCount / detected.length) * 100), message: `识别中 ${recognizedCount}/${detected.length}` });
          if (!dq) continue;
          // 回填题型：优先人工指定，否则用 AI 判断的题型
          const recognizedType = (type ?? (dq.type as QuestionType)) as QuestionType | undefined;
          if (!recognizedType) {
            skipped.push(item.index);
            continue;
          }
          if (!type && recognizedType) {
            // 题型是 AI 首次判断的：记录并在前端提示「AI 判断为 XX，请确认」
            aiAssignedTypes.push({ index: item.index, type: recognizedType });
          }
          const resolvedSubjectId = this.resolveSubject(dq.subject, subjects, subjectId);
          await this.prisma.ocrItem.update({
            where: { id: item.id },
            data: {
              // 题型：人工指定时不被 AI 覆盖；首次识别时回填 AI 判断结果
              type: recognizedType,
              stem: ensureMathDelimiters(this.stripScoreFromStem(this.stripQuestionNumber(dq.stem))),
              content: (this.normalizeContent(recognizedType, dq.content) as Prisma.InputJsonValue) ?? undefined,
              // 录入任务只识别题目 + 标注学科，不在此生成解答（解析/解答统一在题库入库后触发）
              difficulty: dq.difficulty,
              subjectId: resolvedSubjectId,
              confidence: dq.confidence ?? item.confidence,
              status: 'PENDING_REVIEW',
              cropId,
              cropImagePath,
            },
          });
          // 题内图片：按框裁切保存（入库后 content.images 直接可用）
          const savedFigs = await this.saveFigures(page.imagePath, item.figures as unknown as any[] | null);
          if (savedFigs.length && JSON.stringify(savedFigs) !== JSON.stringify(item.figures)) {
            await this.prisma.ocrItem.update({
              where: { id: item.id },
              data: { figures: savedFigs as unknown as Prisma.InputJsonValue },
            });
          }
          await this.prisma.ocrAttempt.create({
            data: {
              ocrItemId: item.id,
              model: result.model,
              parsed: (dq as unknown as Prisma.InputJsonValue) ?? undefined,
              confidence: dq.confidence,
              status: 'SUCCESS',
            },
          });
          (dq.suggestedKnowledgePoints || []).forEach((n) => suggestionNames.add(n));
        }
      }
    } catch (e) {
      await taskUpdate({ status: 'FAILED', message: (e as Error).message?.slice(0, 200) ?? '识别失败' });
      throw e;
    }

    if (subjectId) {
      for (const name of suggestionNames) {
        const exists = await this.prisma.knowledgePointSuggestion.findFirst({
          where: { subjectId, name, status: 'PENDING' },
        });
        if (!exists) {
          await this.prisma.knowledgePointSuggestion.create({
            data: { subjectId, name, suggestedBy: 'ai', status: 'PENDING' },
          });
        }
      }
    }

    await this.prisma.ingestJob.update({
      where: { id: jobId },
      data: { status: 'REVIEWING', pageCount: job.pages.length },
    });
    await this.prisma.aiTaskLog
      .update({
        where: { id: task.id },
        data: {
          status: 'DONE',
          percent: 100,
          done: recognizedCount,
          total: detected.length,
          message: `识别完成，共 ${recognizedCount} 题${skipped.length ? `，${skipped.length} 题待人工指定题型` : ''}`,
        },
      })
      .catch(() => undefined);
    return { job: await this.getJob(jobId), skippedIndexes: skipped, aiAssignedTypes };
  }

  // ---------------- 单题重新识别（审阅台逐题重跑 VLM） ----------------
  async recognizeItem(itemId: string, subjectId?: string) {
    const item = await this.prisma.ocrItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('题目项不存在');
    if (item.status === 'APPROVED') {
      throw new BadRequestException('该题已入库，无法重新识别；如需更新请到题库编辑题目');
    }
    // 仪表盘 AI 工作进度：记录单题识别任务（可点击跳回审阅台）
    const task = await this.prisma.aiTaskLog.create({
      data: {
        type: 'recognize',
        title: `第 ${item.index} 题识别`,
        status: 'RUNNING',
        done: 0,
        total: 1,
        jobId: item.jobId,
      },
    });
    const taskFail = (msg: string) =>
      this.prisma.aiTaskLog
        .update({ where: { id: task.id }, data: { status: 'FAILED', message: msg?.slice(0, 200) } })
        .catch(() => undefined);
    if (!item.pageId) {
      await taskFail('题目项缺少所属页面');
      throw new NotFoundException('题目项缺少所属页面');
    }
    // 题型：已人工指定则按该题型约束；首次识别（未指定）让 VLM 自行判断
    const type = (item.type as QuestionType | null | undefined) ?? undefined;
    const page = await this.prisma.ingestPage.findUnique({ where: { id: item.pageId } });
    if (!page) {
      await taskFail('所属页面不存在');
      throw new NotFoundException('所属页面不存在');
    }

    const bbox = (item.bbox as unknown as BBox) ?? undefined;
    // 合并题：sourceImagePath 为前后页拼接图（≠原页图），整图识别，不再按原页 bbox 裁切
    const isMergedImage = !!item.sourceImagePath && item.sourceImagePath !== page.imagePath;
    let sentImagePath = isMergedImage ? item.sourceImagePath! : page.imagePath;
    let sentBbox: BBox | undefined = isMergedImage ? undefined : bbox;
    let cropId: string | undefined = item.cropId ?? undefined;
    let cropImagePath: string | undefined = item.cropImagePath ?? undefined;

    if (!isMergedImage && bbox && isRasterImage(page.imagePath)) {
      cropId = item.cropId ?? randomUUID();
      cropImagePath = path.join(UPLOAD_DIR, 'crops', `${cropId}.png`);
      try {
        await cropImageByBbox(page.imagePath, bbox, cropImagePath);
        sentImagePath = cropImagePath;
        sentBbox = undefined; // 已是单题图，无需再给 bbox 提示
        await this.prisma.ocrItem.update({ where: { id: item.id }, data: { cropId, cropImagePath } });
      } catch (e) {
        this.logger.warn(
          `[recognizeItem] 单题裁切失败，回退整页识别 item=${item.id}: ${(e as Error).message}`,
        );
        sentImagePath = page.imagePath;
        sentBbox = bbox;
      }
    }

    // 加载学科名单：把 VLM 识别出的学科名映射成真实 subjectId
    const subjects = await this.prisma.subject.findMany({ select: { id: true, name: true, code: true } });
    const subjectNames = subjects.map((s) => s.name);
    const result = await this.vlm.recognize({
      imagePath: sentImagePath,
      mimeType: isPdf(page.imagePath) ? 'application/pdf' : 'image/png',
      subjectId,
      subjectNames,
      type,
      bbox: sentBbox,
    });
    const dq = result.items[0];
    if (!dq) return item;
    // 回填题型：优先人工指定，否则用 AI 判断
    const recognizedType = (type ?? (dq.type as QuestionType)) as QuestionType | undefined;
    if (!recognizedType) {
      throw new BadRequestException('AI 未能判断该题题型，请先选择题型后再重新识别');
    }
    const resolvedSubjectId = this.resolveSubject(dq.subject, subjects, item.subjectId ?? subjectId);
    // 归一化新识别内容；阅读理解重新识别时保留用户已改的小题题型（整页识别才让 AI 识别题型）
    const newContent = this.normalizeContent(recognizedType, dq.content);
    const content = this.mergeReadingSubTypes(item.content as any, newContent, recognizedType);
    const updated = await this.prisma.ocrItem.update({
      where: { id: item.id },
      data: {
        // 题型：人工指定时不被 AI 覆盖；首次识别时回填 AI 判断结果
        type: recognizedType,
        stem: ensureMathDelimiters(this.stripScoreFromStem(this.stripQuestionNumber(dq.stem))),
        content: (content as Prisma.InputJsonValue) ?? undefined,
        difficulty: dq.difficulty,
        subjectId: resolvedSubjectId,
        confidence: dq.confidence ?? item.confidence,
        status: 'PENDING_REVIEW',
        cropId,
        cropImagePath,
      },
    });
    // 题内图片：按框裁切保存（入库后 content.images 直接可用）
    const savedFigs = await this.saveFigures(page.imagePath, item.figures as unknown as any[] | null);
    if (savedFigs.length && JSON.stringify(savedFigs) !== JSON.stringify(item.figures)) {
      await this.prisma.ocrItem.update({
        where: { id: item.id },
        data: { figures: savedFigs as unknown as Prisma.InputJsonValue },
      });
    }
    await this.prisma.ocrAttempt.create({
      data: {
        ocrItemId: item.id,
        model: result.model,
        parsed: (dq as unknown as Prisma.InputJsonValue) ?? undefined,
        confidence: dq.confidence,
        status: 'SUCCESS',
      },
    });
    await this.refreshJobStatus(item.jobId);
    await this.prisma.aiTaskLog
      .update({
        where: { id: task.id },
        data: {
          status: 'DONE',
          percent: 100,
          done: 1,
          total: 1,
          message: `第 ${item.index} 题识别完成${!type && recognizedType ? `（AI 判断题型：${recognizedType}）` : ''}`,
        },
      })
      .catch(() => undefined);
    return updated;
  }

  // ---------------- 人工新增一个框（步骤 3 辅助） ----------------
  async addBox(pageId: string, bbox: number[], type?: string) {
    if (!Array.isArray(bbox) || bbox.length !== 4) throw new BadRequestException('bbox 格式应为 [x0,y0,x1,y1]');
    const page = await this.prisma.ingestPage.findUnique({ where: { id: pageId }, include: { job: true } });
    if (!page) throw new NotFoundException('页面不存在');
    const max = await this.prisma.ocrItem.aggregate({ where: { jobId: page.jobId }, _max: { index: true } });
    const item = await this.prisma.ocrItem.create({
      data: {
        jobId: page.jobId,
        pageId,
        index: (max._max.index ?? 0) + 1,
        status: 'DETECTED',
        type: (type as any) ?? undefined,
        bbox: (bbox as Prisma.InputJsonValue) ?? undefined,
        sourceImagePath: page.imagePath,
        paperName: page.paperName ?? undefined,
      },
    });
    await this.reindexItems(page.jobId); // 重编号：新增框后序号连续无跳号
    await this.refreshJobStatus(page.jobId);
    return item;
  }

  // 页面级图片框：手绘一个图片区域，立即按页裁切写入页面 figures（与题目框解耦）
  async addPageFigure(pageId: string, bbox: number[], label?: string) {
    if (!Array.isArray(bbox) || bbox.length !== 4) throw new BadRequestException('bbox 格式应为 [x0,y0,x1,y1]');
    const page = await this.prisma.ingestPage.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException('页面不存在');
    const existing = (Array.isArray(page.figures) ? page.figures : []) as unknown as any[];
    const fresh = [{ bbox, label: label || '题内图片' }];
    const cropped = await this.saveFigures(page.imagePath, fresh);
    const updated = [...existing, ...cropped] as unknown as Prisma.InputJsonValue;
    await this.prisma.ingestPage.update({ where: { id: pageId }, data: { figures: updated } });
    return cropped[0] ?? fresh[0];
  }

  // 页面级图片框：移动/缩放/删除后整体替换。仅对「新增」或「bbox 变化」的项重新裁切，
  // 其余保留原 cropId（已采用到题目的图不会因重排而失联）。
  async updatePageFigures(pageId: string, figures: Array<{ bbox: number[]; cropId?: string; label?: string }>) {
    const page = await this.prisma.ingestPage.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException('页面不存在');
    const stored = (Array.isArray(page.figures) ? page.figures : []) as unknown as any[];
    const byCrop = new Map<string, any>();
    stored.forEach((s, i) => byCrop.set(s?.cropId || `i${i}`, s));
    const out: any[] = [];
    for (const f of figures || []) {
      if (f?.cropId && byCrop.has(f.cropId)) {
        const s = byCrop.get(f.cropId);
        if (JSON.stringify(s.bbox) === JSON.stringify(f.bbox)) {
          out.push(f); // 未变，保留原裁切
          continue;
        }
      }
      const cropped = await this.saveFigures(page.imagePath, [{ ...f }]);
      out.push(cropped[0] ?? f);
    }
    await this.prisma.ingestPage.update({
      where: { id: pageId },
      data: { figures: out as unknown as Prisma.InputJsonValue },
    });
    return out;
  }

  // ---------------- 列表 / 详情 ----------------
  async listJobs(dto: IngestQueryDto) {
    const where: any = {};
    if (dto.status) where.status = dto.status;
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.ingestJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          // 题目数只统计有效项（排除被合并项 mergedIntoId 非空）：
          // 合并后两张图合为一张图、舍弃一个 id，题目数随之减 1。
          _count: { select: { items: { where: { mergedIntoId: null } } } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.ingestJob.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /** 列出文件（试卷/作业本），按名称聚合（同一名称多个任务合并），供题库「按试卷/作业本」浏览 */
  async listFiles(sourceType?: 'PAPER' | 'WORKBOOK') {
    const jobs = await this.prisma.ingestJob.findMany({
      where: { sourceType: sourceType || { not: null }, status: { not: 'UPLOADED' } },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { items: { where: { mergedIntoId: null } } } },
        pages: { select: { id: true } },
      },
    });
    const map = new Map<string, { id: string; name: string; subjectId: string | null; count: number; pageId: string | null }>();
    for (const j of jobs) {
      const key = j.fileName;
      const existing = map.get(key);
      if (existing) {
        existing.count += j._count?.items ?? 0;
      } else {
        map.set(key, {
          id: j.id,
          name: j.fileName,
          subjectId: j.subjectId,
          count: j._count?.items ?? 0,
          pageId: j.pages?.[0]?.id ?? null,
        });
      }
    }
    return Array.from(map.values());
  }

  async getJob(jobId: string) {
    const job = await this.prisma.ingestJob.findUnique({
      where: { id: jobId },
      include: {
        pages: true,
        // 返回全部题项（含被合并项 mergedIntoId 非空）：
        // 前端框选编辑器/审阅台需展示「合并题的两个原始框、两张原图」供人工核对。
        items: {
          orderBy: { index: 'asc' },
          include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
        },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!job) throw new NotFoundException('录入任务不存在');
    return job;
  }

  // ---------------- 删除录入任务（含级联的页面与题目项） ----------------
  async deleteJob(jobId: string) {
    const job = await this.prisma.ingestJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('录入任务不存在');
    // 级联删除：IngestPage / OcrItem 已配置 onDelete: Cascade
    await this.prisma.ingestJob.delete({ where: { id: jobId } });
    return { ok: true };
  }

  // ---------------- 审阅台统一操作区：批量设置文件类型/名称/学科/作业本层级 ----------------
  async updateJobMeta(
    jobId: string,
    dto: {
      sourceType?: 'PAPER' | 'WORKBOOK';
      name?: string;
      subjectId?: string;
      workbookId?: string;
      workbookSectionId?: string | null;
    },
  ) {
    const job = await this.prisma.ingestJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('录入任务不存在');

    const data: any = {
      sourceType: dto.sourceType ?? job.sourceType ?? undefined,
      subjectId: dto.subjectId || job.subjectId || undefined,
      fileName: dto.name ?? job.fileName,
    };
    // 选「是作业本」时指向已有作业本；切回试卷时清空 workbookId 与章节
    if (dto.sourceType === 'WORKBOOK') {
      if (dto.workbookId) data.workbookId = dto.workbookId;
      if (dto.workbookSectionId !== undefined) data.workbookSectionId = dto.workbookSectionId || null;
    } else if (dto.sourceType === 'PAPER') {
      data.workbookId = null;
      data.workbookSectionId = null;
    } else if (dto.workbookId) {
      data.workbookId = dto.workbookId;
    } else if (dto.workbookSectionId !== undefined) {
      data.workbookSectionId = dto.workbookSectionId || null;
    }

    await this.prisma.ingestJob.update({ where: { id: jobId }, data });

    // 批量更新该文件下所有未定稿题目的学科 + 所属试卷/作业本名
    const itemData: any = {};
    if (dto.subjectId) itemData.subjectId = dto.subjectId;
    if (dto.name) itemData.paperName = dto.name;
    if (Object.keys(itemData).length) {
      await this.prisma.ocrItem.updateMany({
        where: { jobId, status: { in: ['DETECTED', 'PENDING_REVIEW'] } },
        data: itemData,
      });
    }

    return this.getJob(jobId);
  }

  // ---------------- 试卷编辑（题库「编辑试卷」窗口） ----------------
  // 改名：更新文件记录名 + 同步该卷所有题目的来源记录（sourcePapers/sourcePaperName）；
  // 题目排序/大题：批量更新题项 number/groupIndex/groupTitle（已入库的同步到 Question）。
  async editPaper(
    jobId: string,
    dto: {
      name?: string;
      items?: { id: string; number?: number | null; groupIndex?: number | null; groupTitle?: string | null }[];
    },
  ) {
    const job = await this.prisma.ingestJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('录入任务不存在');

    if (dto.name && dto.name.trim() && dto.name.trim() !== job.fileName) {
      const oldName = job.fileName;
      const newName = dto.name.trim();
      await this.prisma.ingestJob.update({ where: { id: jobId }, data: { fileName: newName } });
      // 该文件下的题目：sourcePapers 旧名→新名、sourcePaperName 更新
      const questions = await this.prisma.question.findMany({
        where: { sourceFileId: jobId },
        select: { id: true, sourcePapers: true, sourcePaperName: true },
      });
      await Promise.all(
        questions.map((qq) =>
          this.prisma.question.update({
            where: { id: qq.id },
            data: {
              sourcePapers: (qq.sourcePapers || []).map((p) => (p === oldName ? newName : p)),
              sourcePaperName: qq.sourcePaperName === oldName ? newName : qq.sourcePaperName,
            },
          }),
        ),
      );
      // 未定稿题目项的 paperName 同步
      await this.prisma.ocrItem.updateMany({
        where: { jobId, paperName: oldName },
        data: { paperName: newName },
      });
    }

    if (Array.isArray(dto.items) && dto.items.length) {
      // 「编辑试卷」窗口传入的是题库 Question 的 id（按试卷浏览的题目已是入库 Question）。
      // 因此先更新 Question 的题号/大题，再经 assignedQuestionId 同步到对应的录入题目项 OcrItem，
      // 保证审阅台「大题与题号」面板与题库一致。
      // （旧逻辑直接按 Question id 去更新 ocrItem 表 → 找不到记录 → 命中 P2025「记录不存在或已被删除」）
      const validItems = dto.items.filter((it) => !!it.id);
      await Promise.all(
        validItems.map((it) =>
          this.prisma.question.update({
            where: { id: it.id! },
            data: {
              number: it.number === undefined ? undefined : it.number,
              groupIndex: it.groupIndex === undefined ? undefined : it.groupIndex,
              groupTitle: it.groupTitle === undefined ? undefined : it.groupTitle,
            },
          }),
        ),
      );
      // 同步到关联录入题目项（仅当存在 assignedQuestionId 指向该题时）
      const linkedItems = await Promise.all(
        validItems.map(async (it) => {
          const ocr = await this.prisma.ocrItem.findFirst({
            where: { assignedQuestionId: it.id! },
            select: { id: true },
          });
          return ocr ? { oid: ocr.id, it } : null;
        }),
      );
      await Promise.all(
        linkedItems
          .filter((x): x is { oid: string; it: (typeof dto.items)[number] } => !!x)
          .map(({ oid, it }) =>
            this.prisma.ocrItem.update({
              where: { id: oid },
              data: {
                number: it.number === undefined ? undefined : it.number,
                groupIndex: it.groupIndex === undefined ? undefined : it.groupIndex,
                groupTitle: it.groupTitle === undefined ? undefined : it.groupTitle,
              },
            }),
          ),
      );
    }

    return this.getJob(jobId);
  }

  // ---------------- 审阅台编辑（步骤 3/5：可改框、所属试卷、属性） ----------------
  async reviewItem(itemId: string, dto: ReviewItemDto) {
    const item = await this.prisma.ocrItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('题目项不存在');
    // 被合并项只读（撤销合并后才能改）
    if (item.mergedIntoId) {
      throw new BadRequestException('该题已被合并为一道题，请先「撤销合并」再修改');
    }
    // 标记为「已丢弃」即删除该框：题目数随之减少。已入库的框不可删除，保留供追溯。
    if (dto.status === 'DISCARDED') {
      if (item.status === 'APPROVED') {
        throw new BadRequestException('该题已入库，不可删除框。如需修改请到题库编辑，或先删除题库题目后重新录入');
      }
      await this.prisma.ocrItem.delete({ where: { id: itemId } });
      await this.reindexItems(item.jobId); // 重编号：删除后序号连续无跳号，与框选编辑器一致
      await this.refreshJobStatus(item.jobId);
      return { id: itemId, deleted: true } as any;
    }
    // 关键：只有前端显式传入的字段才更新（undefined 不覆盖）。
    // 否则只改 groupTitle/groupIndex 时，stem/content/analysis 会被 ensureMathDelimiters(undefined)='' 清空。
    const data: Prisma.OcrItemUncheckedUpdateInput = {
      type: dto.type === undefined ? undefined : dto.type,
      stem: dto.stem === undefined ? undefined : ensureMathDelimiters(dto.stem),
      content: dto.content === undefined ? undefined : (dto.content as Prisma.InputJsonValue),
      analysis: dto.analysis === undefined ? undefined : ensureMathDelimiters(dto.analysis),
      difficulty: dto.difficulty === undefined ? undefined : dto.difficulty,
      subjectId: dto.subjectId === undefined ? undefined : dto.subjectId,
      paperName: dto.paperName === undefined ? undefined : dto.paperName,
      status: dto.status ?? item.status,
      // 大题分组/题号：审阅台右侧题号面板拖拽即保存（undefined 不覆盖）
      groupIndex: dto.groupIndex === undefined ? undefined : dto.groupIndex,
      groupTitle: dto.groupTitle === undefined ? undefined : dto.groupTitle,
      number: dto.number === undefined ? undefined : dto.number,
    };
    // 修改已入库题的框：刷新入库状态（回到待识别），需重新识别并再次入库
    if (dto.bbox) {
      data.bbox = dto.bbox as unknown as Prisma.InputJsonValue;
      if (item.status === 'APPROVED' || item.assignedQuestionId) {
        data.status = 'DETECTED';
        data.assignedQuestionId = null;
      }
    }
    if (dto.figures) {
      data.figures = dto.figures as unknown as Prisma.InputJsonValue;
    }
    const updated = await this.prisma.ocrItem.update({
      where: { id: itemId },
      data,
    });
    // 框选器里框的题图：若尚无裁切图（cropId，通常是框选器里手动后补框的图），按所在页裁出，
    // 确保审阅台「+图片 → 采用已框题图」与题库都能取到这张图。
    if (dto.figures && Array.isArray(dto.figures) && item.pageId) {
      const page = await this.prisma.ingestPage.findUnique({ where: { id: item.pageId } });
      if (page?.imagePath && isRasterImage(page.imagePath)) {
        const cropped = await this.saveFigures(page.imagePath, dto.figures as unknown as any[]);
        if (JSON.stringify(cropped) !== JSON.stringify(dto.figures)) {
          return this.prisma.ocrItem.update({
            where: { id: itemId },
            data: { figures: cropped as unknown as Prisma.InputJsonValue },
          });
        }
      }
    }
    return updated;
  }

  // ---------------- 批准入题（步骤 6） ----------------
  async approveItem(itemId: string, dto: ApproveItemDto, user: AuthenticatedUser) {
    const item = await this.prisma.ocrItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('题目项不存在');
    if (item.assignedQuestionId) {
      return this.prisma.question.findUnique({ where: { id: item.assignedQuestionId } });
    }

    const rawContent = (item.content as Record<string, any>) ?? {};
    // 阅读理解大题：题干（引语）可空，用「材料/小题」判断是否有效；其他题型仍要求题干非空
    const isReading = item.type === 'READING_COMPREHENSION';
    const hasReadingContent =
      isReading &&
      ((Array.isArray(rawContent.subQuestions) && rawContent.subQuestions.length > 0) ||
        (typeof rawContent.passage === 'string' && rawContent.passage.trim() !== ''));
    if (!item.stem && !hasReadingContent) {
      throw new BadRequestException('题干为空，请先在审阅台补全后再入库');
    }
    // 阅读理解大题的题干（引语）可为空，入库给占位标题（材料在 content.passage、小题在 content.subQuestions）
    const stem = isReading ? item.stem || '阅读理解' : item.stem!;

    // 来源图：优先用按 bbox 裁出的单题图（已是单题，无需再裁）；否则回退整页图 + bbox
    const useCrop = !!item.cropImagePath;
    const sourceImagePath = item.cropImagePath ?? item.sourceImagePath ?? undefined;
    const contentWithSource: Record<string, any> = { ...rawContent };
    if (!useCrop && Array.isArray(item.bbox)) {
      contentWithSource.sourceBbox = [
        Number(item.bbox[0]),
        Number(item.bbox[1]),
        Number(item.bbox[2]),
        Number(item.bbox[3]),
      ];
    }
    // 题内图片：把 OCR 识别的 figures（裁切后）+ 审阅台「+图片」添加的合并到 content.images（去重 cropId）
    const ocrImgs = (Array.isArray(item.figures) ? item.figures : [])
      .filter((f: any) => typeof f?.cropId === 'string' && f.cropId)
      .map((f: any) => ({
        cropId: f.cropId as string,
        label: typeof f.label === 'string' && f.label ? f.label : '题目图片',
        bbox: Array.isArray(f.bbox) ? f.bbox.map(Number) : undefined,
      }));
    const existingImgs = Array.isArray(contentWithSource.images) ? (contentWithSource.images as any[]) : [];
    const merged = new Map<string, any>();
    for (const x of [...ocrImgs, ...existingImgs]) {
      if (x?.cropId && !merged.has(x.cropId)) merged.set(x.cropId, x);
    }
    const mergedList = Array.from(merged.values());
    if (mergedList.length) contentWithSource.images = mergedList;

    const paperName = dto.paperName || item.paperName || undefined;
    // 入库硬性要求：每道题都必须归属到一张试卷（与题库编辑保存校验一致）
    if (!paperName) {
      throw new BadRequestException(
        '该题未填写「所属试卷」，无法入库。请在右侧「所属试卷」填写试卷名称（如：2023 高考数学全国卷 I）',
      );
    }

    // 入库不自动合并：疑似重复仅作提示，照常录入（合并交由「题目查重」页人工处理）。
    // fast 模式只做确定性判定，省去 LLM 精判的 token 开销。
    const duplicate = await this.questions.findDuplicate({
      type: item.type ?? 'SHORT_ANSWER',
      stem,
      content: contentWithSource,
      subjectId: dto.subjectId,
      fast: true,
    });
    const duplicateWarning = duplicate
      ? { questionId: duplicate.id, sourcePapers: duplicate.sourcePapers }
      : null;

    // 作业本归属：若本文件在审阅台选了「是作业本 + 已有作业本」，则题目归属该作业本，
    // sourcePath 暂为 [作业本名]（根），章节在作业本视图内按需分配。
    let workbookId: string | undefined;
    let sourcePath: string[] = [];
    if (item.jobId) {
      const job = await this.prisma.ingestJob.findUnique({
        where: { id: item.jobId },
        select: { workbookId: true, workbookSectionId: true },
      });
      if (job?.workbookId) {
        const wb = await this.prisma.workbook.findUnique({
          where: { id: job.workbookId },
          select: { id: true, name: true },
        });
        if (wb) {
          workbookId = wb.id;
          sourcePath = [wb.name];
          // 若审阅台选了具体章节，则按章节全路径（作业本名 → 章节 → 子章节）写 sourcePath，
          // 使审批入库的题目直接落到所选章节下（无需再到作业本视图二次分配）。
          if (job.workbookSectionId) {
            const sections = await this.prisma.workbookSection.findMany({
              where: { workbookId: wb.id },
              select: { id: true, name: true, parentId: true },
            });
            const map = new Map<string, { name: string; parentId: string | null }>(
              sections.map((s) => [s.id, { name: s.name, parentId: s.parentId }]),
            );
            const names: string[] = [];
            let cur: { name: string; parentId: string | null } | undefined = map.get(job.workbookSectionId);
            while (cur) {
              names.unshift(cur.name);
              cur = cur.parentId ? map.get(cur.parentId) : undefined;
            }
            if (names.length) sourcePath = [wb.name, ...names];
          }
        }
      }
    }

    const question = await this.questions.create(
      {
        // 入库后的题目唯一 id = 单题裁切 id（保证裁切图文件名与题目 id 一致）
        id: item.cropId ?? undefined,
        type: item.type ?? 'SHORT_ANSWER',
        stem: ensureMathDelimiters(stem),
        content: contentWithSource,
        analysis: ensureMathDelimiters(item.analysis ?? undefined),
        difficulty: item.difficulty ?? 3,
        subjectId: dto.subjectId,
        tagIds: dto.tagIds,
        knowledgePointIds: dto.knowledgePointIds,
        sourceType: 'OCR',
        sourcePaperName: paperName,
        sourcePapers: paperName ? [paperName] : [],
        number: item.number ?? undefined,
        groupIndex: item.groupIndex ?? undefined,
        groupTitle: item.groupTitle ?? undefined,
        sourceFileId: item.jobId,
        workbookId: workbookId || undefined,
        sourcePath,
        sourceImagePath,
      },
      user.id,
    );
    // 入库后异步生成语义向量（用于查重页第二层语义召回）；失败仅告警，不影响入库。
    void this.questions.refreshEmbedding(question.id);
    await this.prisma.ocrItem.update({
      where: { id: itemId },
      data: { assignedQuestionId: question.id, status: 'APPROVED' },
    });
    await this.refreshJobStatus(item.jobId);

    // 注意：录入任务不再自动生成解答。解析/解答统一在题库侧「生成 AI 解答」触发（入库后）。
    // 疑似重复仅作提示（duplicateWarning），不阻断录入。
    const result = question as typeof question & {
      duplicateWarning?: { questionId: string; sourcePapers: string[] } | null;
    };
    result.duplicateWarning = duplicateWarning;
    return result;
  }

  async rejectItem(itemId: string) {
    const item = await this.prisma.ocrItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('题目项不存在');
    await this.prisma.ocrItem.update({ where: { id: itemId }, data: { status: 'REJECTED' } });
    await this.refreshJobStatus(item.jobId);
    return { ok: true };
  }

  // ---------------- 页面图片服务（供前端框选编辑器展示） ----------------
  async getPageImage(pageId: string): Promise<{ buffer: Buffer; mime: string }> {
    const page = await this.prisma.ingestPage.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException('页面不存在');
    const ext = path.extname(page.imagePath).toLowerCase();
    const mime =
      ext === '.pdf'
        ? 'application/pdf'
        : ext === '.png'
          ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.webp'
              ? 'image/webp'
              : 'application/octet-stream';
    const buffer = await fs.readFile(page.imagePath);
    return { buffer, mime };
  }

  // ---------------- AI 知识点建议 ----------------
  async listSuggestions(subjectId?: string) {
    const where: any = { status: 'PENDING' };
    if (subjectId) where.subjectId = subjectId;
    return this.prisma.knowledgePointSuggestion.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async approveSuggestion(id: string, parentId?: string) {
    const s = await this.prisma.knowledgePointSuggestion.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('建议不存在');
    const created = await this.prisma.knowledgePoint.create({
      data: {
        subjectId: s.subjectId,
        name: s.name,
        parentId: parentId ?? s.parentId ?? undefined,
        path: s.name,
      },
    });
    if (parentId) {
      const parent = await this.prisma.knowledgePoint.findUnique({ where: { id: parentId } });
      if (parent) {
        await this.prisma.knowledgePoint.update({
          where: { id: created.id },
          data: { path: `${parent.path}.${created.id}`, level: parent.level + 1 },
        });
      }
    } else {
      await this.prisma.knowledgePoint.update({
        where: { id: created.id },
        data: { path: created.id },
      });
    }
    await this.prisma.knowledgePointSuggestion.update({ where: { id }, data: { status: 'APPROVED' } });
    return created;
  }

  async rejectSuggestion(id: string) {
    const s = await this.prisma.knowledgePointSuggestion.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('建议不存在');
    await this.prisma.knowledgePointSuggestion.update({ where: { id }, data: { status: 'REJECTED' } });
    return { ok: true };
  }

  // ---------------- 内部 ----------------
  /**
   * 把 VLM 返回的学科自由文本映射成系统真实 subjectId。
   * 优先精确匹配（名称/编码，忽略大小写），其次包含匹配（如「高中数学」含「数学」）；
   * 均不命中则返回 fallback（识别时即任务级 subjectId，重识别时即该题原 subjectId 或任务级）。
   */
  private resolveSubject(
    raw: string | undefined,
    subjects: { id: string; name: string; code: string | null }[],
    fallbackId?: string | null,
  ): string | undefined {
    if (raw && raw.trim()) {
      const key = raw.trim().toLowerCase();
      const exact = subjects.find(
        (s) => s.name.toLowerCase() === key || (s.code ? s.code.toLowerCase() === key : false),
      );
      if (exact) return exact.id;
      const fuzzy = subjects.find((s) => {
        const n = s.name.toLowerCase();
        return n.includes(key) || key.includes(n);
      });
      if (fuzzy) return fuzzy.id;
    }
    return fallbackId ?? undefined;
  }

  /** 剔除题干开头的题号前缀（如「1.」「12、」「3）」，避免题号被写进题干文本） */
  private stripQuestionNumber(stem: string | null | undefined): string {
    if (!stem) return '';
    return stem.replace(/^\s*\d{1,3}\s*[.、．)）:：]\s*/, '');
  }

  /** 剔除题干末尾的分值标注（如「（10分）」「(10 分)」），分值单独存 content.score */
  private stripScoreFromStem(stem: string | null | undefined): string {
    if (!stem) return '';
    return stem.replace(/[（(]\s*\d+(?:\.\d+)?\s*分\s*[)）]\s*$/, '').replace(/[\s,，、;；]+$/, '');
  }

  /**
   * 将 VLM 返回的自由格式 content 规整为题型标准结构，确保前端能按题型渲染。
   * 录入识别阶段只收录「题目本身」，不写入任何答案（答案统一在题库侧「生成 AI 解答」时产出）：
   * - 单选/多选：options[{key,text}]（不含 correct）
   * - 判断：options[{key:'T'|'F',text}]（不含 answer）
   * - 填空：仅保留题干，不写 blanks 答案
   * - 材料：subQuestions[{stem,score}]（不含 answer）
   * - 其他：仅保留题干，不写 rubric/answer
   */
  private normalizeContent(type: QuestionType | null | undefined, raw: any): Record<string, any> {
    const content: Record<string, any> = {};
    if (!raw || typeof raw !== 'object') raw = {};
    // 分值：题干中剥离出的「（X分）」单独存 content.score（大题分值）
    if (typeof raw.score === 'number' && Number.isFinite(raw.score)) {
      content.score = raw.score;
    }
    const letter = (i: number) => String.fromCharCode(65 + i);

    if (type === 'SINGLE_CHOICE' || type === 'MULTIPLE_CHOICE') {
      let opts: any[] = Array.isArray(raw.options) ? raw.options : [];
      if (!opts.length && Array.isArray(raw.choices)) opts = raw.choices;
      if (!opts.length && Array.isArray(raw.answers)) opts = raw.answers;
      const norm: { key: string; text: string; correct?: boolean }[] = opts.map((o, i) => {
        if (typeof o === 'string') return { key: letter(i), text: o };
        const key = o.key ?? letter(i);
        return {
          key,
          text: ensureMathDelimiters(o.text ?? o.value ?? o.content ?? ''),
        };
      });
      content.options = norm;
    } else if (type === 'TRUE_FALSE') {
      content.options = [
        { key: 'T', text: raw.trueText ?? '正确' },
        { key: 'F', text: raw.falseText ?? '错误' },
      ];
    } else if (type === 'FILL_BLANK') {
      // 录入阶段只识别题目，不写答案（答案在「生成 AI 解答」时回填）
    } else if (type === 'SHORT_ANSWER' || type === 'ESSAY') {
      // 简答/论述大题：若含多个小问，识别小题干列表（答案由「生成 AI 解答」回填）
      const subs = Array.isArray(raw.subQuestions)
        ? raw.subQuestions
        : Array.isArray(raw.subquestions)
          ? raw.subquestions
          : [];
      if (subs.length) {
        content.subQuestions = subs
          .map((s: any) => {
            const stem = ensureMathDelimiters(s?.stem ?? '');
            if (!stem) return null;
            const sq: Record<string, any> = { stem };
            if (typeof s?.score === 'number' && Number.isFinite(s.score)) sq.score = s.score;
            // 小题题型：首次识别由 AI 判断（人工可改）
            if (s?.type && QUESTION_TYPES_SET.has(s.type)) sq.type = s.type;
            return sq;
          })
          .filter(Boolean);
      }
    } else if (type === 'MATERIAL') {
      const subs = Array.isArray(raw.subQuestions)
        ? raw.subQuestions
        : Array.isArray(raw.subquestions)
          ? raw.subquestions
          : [];
      content.subQuestions = subs.map((s: any) => ({
        stem: ensureMathDelimiters(s?.stem ?? ''),
        score: typeof s?.score === 'number' ? s.score : undefined,
      }));
    } else if (type === 'READING_COMPREHENSION') {
      // 阅读理解大题：识别材料 + 每个小题的题型 + 题干 + 选项（选择类小题）。
      // 材料/大题题干识别后保存到后台（供「生成 AI 解答」有题目文本），但审阅台不展示让用户填；
      // 答案/正确选项/解析不识别（答案在「生成 AI 解答」回填）。
      const passage = typeof raw.passage === 'string' ? raw.passage : typeof raw.material === 'string' ? raw.material : '';
      const subs = Array.isArray(raw.subQuestions)
        ? raw.subQuestions
        : Array.isArray(raw.subquestions)
          ? raw.subquestions
          : [];
      content.passage = ensureMathDelimiters(passage);
      content.subQuestions = subs
        .map((s: any) => {
          const stem = ensureMathDelimiters(s?.stem ?? '');
          if (!stem) return null;
          let opts: any[] = Array.isArray(s?.options) ? s.options : [];
          if (!opts.length && Array.isArray(s?.choices)) opts = s.choices;
          const options = opts.map((o: any, i: number) => {
            if (typeof o === 'string') return { key: letter(i), text: o };
            return { key: o.key ?? letter(i), text: ensureMathDelimiters(o.text ?? o.value ?? o.content ?? '') };
          });
          const sq: Record<string, any> = { type: (s.type as QuestionType | undefined) ?? undefined, stem };
          if (options.length) sq.options = options;
          if (typeof s?.score === 'number' && Number.isFinite(s.score)) sq.score = s.score;
          return sq;
        })
        .filter(Boolean);
    }
    // 其他题型（简答/论述/短文等）录入阶段仅识别题干，不写 rubric/answer
    return content;
  }

  /**
   * 阅读理解大题：单题重新识别时，保留用户已手动改过的小题题型。
   * 整页识别(recognize)让 AI 识别小题题型；单题重识别(recognizeItem)后若用户改过题型，
   * 用旧题型覆盖 AI 新识别的题型（仅当旧小题该位置存在 type 时），避免覆盖用户修改。
   */
  private mergeReadingSubTypes(oldContent: any, newContent: any, type: QuestionType | undefined): any {
    if (type !== 'READING_COMPREHENSION') return newContent;
    const oldSubs = Array.isArray(oldContent?.subQuestions) ? oldContent.subQuestions : [];
    const newSubs = Array.isArray(newContent?.subQuestions) ? newContent.subQuestions : [];
    if (!newSubs.length) return newContent;
    const merged = newSubs.map((s: any, i: number) => {
      const oldType = oldSubs[i]?.type;
      if (oldType) return { ...s, type: oldType };
      return s;
    });
    return { ...newContent, subQuestions: merged };
  }

  /**
   * 题内图片：按 figures bbox 逐张裁切保存到 crops/{cropId}.png，
   * 返回带 cropId 的 figures（入库后 content.images 可直接展示）。
   */
  private async saveFigures(pageImagePath: string, figures: any[] | null | undefined): Promise<any[]> {
    if (!Array.isArray(figures) || !figures.length) return figures ?? [];
    const out: any[] = [];
    for (const f of figures) {
      const fb = Array.isArray(f.bbox) && f.bbox.length === 4 ? (f.bbox as BBox) : undefined;
      if (!fb || !isRasterImage(pageImagePath)) {
        out.push(f);
        continue;
      }
      const cropId = randomUUID();
      const fPath = path.join(UPLOAD_DIR, 'crops', `${cropId}.png`);
      try {
        await cropImageByBbox(pageImagePath, fb, fPath);
        out.push({ ...f, cropId });
      } catch (e) {
        this.logger.warn(`[figures] 题图裁切失败: ${(e as Error).message}`);
        out.push(f);
      }
    }
    return out;
  }

  private async refreshJobStatus(jobId: string) {
    const items = await this.prisma.ocrItem.findMany({ where: { jobId }, select: { status: true } });
    if (!items.length) return;
    const resolved = items.every((i) => i.status === 'APPROVED' || i.status === 'REJECTED');
    if (resolved) {
      await this.prisma.ingestJob.update({ where: { id: jobId }, data: { status: 'DONE' } });
    }
  }

  /**
   * 重新编号任务内所有题项：按页序 → 页内按 bbox 纵向坐标（自上而下）排序，生成连续 index(1..N)。
   * 删除/新增框后调用，保证序号无跳号，且框选编辑器（按排序动态编号）与审阅台（读 item.index）一致。
   */
  private async reindexItems(jobId: string) {
    const pages = await this.prisma.ingestPage.findMany({
      where: { jobId },
      orderBy: { pageNumber: 'asc' },
      select: { id: true, pageNumber: true },
    });
    const items = await this.prisma.ocrItem.findMany({
      where: { jobId },
      select: { id: true, pageId: true, bbox: true },
    });
    const pageOrder = new Map<string, number>(pages.map((p, i) => [p.id, i]));
    const sorted = items
      .map((it) => {
        const bb = (it.bbox as number[]) || [0, 0, 1, 1];
        return { id: it.id, order: (pageOrder.get(it.pageId ?? '') ?? 0) * 10000 + (bb[1] ?? 0) * 100 };
      })
      .sort((a, b) => a.order - b.order);
    if (!sorted.length) return;
    await this.prisma.$transaction(
      sorted.map((it, i) =>
        this.prisma.ocrItem.update({ where: { id: it.id }, data: { index: i + 1 } }),
      ),
    );
  }
}
