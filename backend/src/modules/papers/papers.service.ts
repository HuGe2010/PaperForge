import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { QuestionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePaperDto } from './dto/create-paper.dto';
import { UpdatePaperDto } from './dto/create-paper.dto';
import { ComposeDto } from './dto/compose.dto';
import { AddQuestionDto, BatchAddQuestionsDto, ReorderDto, SetScoreDto } from './dto/paper-question.dto';
import { AuthenticatedUser } from '../../common/types/request';

/** 各题型默认分值（智能组卷未指定分数时使用） */
export const DEFAULT_SCORE: Record<QuestionType, number> = {
  SINGLE_CHOICE: 4,
  MULTIPLE_CHOICE: 6,
  TRUE_FALSE: 2,
  FILL_BLANK: 4,
  SHORT_ANSWER: 8,
  ESSAY: 12,
  MATERIAL: 15,
  READING_COMPREHENSION: 15,
};

export interface ComposeCandidate {
  id: string;
  type: QuestionType;
  stem: string;
  difficulty: number;
  score: number;
}

@Injectable()
export class PapersService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------- 试卷 CRUD ----------------
  async create(dto: CreatePaperDto, userId?: string) {
    return this.prisma.paper.create({
      data: {
        title: dto.title,
        description: dto.description,
        subjectId: dto.subjectId,
        estimatedMinutes: dto.estimatedMinutes,
        status: dto.status ?? 'DRAFT',
        createdById: userId,
      },
    });
  }

  async update(id: string, dto: UpdatePaperDto) {
    await this.assertPaper(id);
    return this.prisma.paper.update({ where: { id }, data: { ...dto } });
  }

  async remove(id: string) {
    await this.assertPaper(id);
    return this.prisma.paper.delete({ where: { id } });
  }

  async list(dto: { status?: string; page?: number; pageSize?: number }) {
    const where: any = {};
    if (dto.status) where.status = dto.status;
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.paper.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { questions: true } },
          subject: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.paper.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(id: string) {
    const paper = await this.prisma.paper.findUnique({
      where: { id },
      include: {
        subject: { select: { id: true, name: true } },
        questions: {
          orderBy: { order: 'asc' },
          include: {
            question: { select: { id: true, type: true, stem: true, difficulty: true, analysis: true } },
          },
        },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!paper) throw new NotFoundException('试卷不存在');
    return paper;
  }

  // ---------------- 智能抽题 ----------------
  async compose(dto: ComposeDto): Promise<ComposeCandidate[]> {
    const where: any = {};
    if (dto.subjectId) where.subjectId = dto.subjectId;
    if (dto.types?.length) where.type = { in: dto.types };
    if (dto.difficultyMin || dto.difficultyMax) {
      where.difficulty = {};
      if (dto.difficultyMin) where.difficulty.gte = dto.difficultyMin;
      if (dto.difficultyMax) where.difficulty.lte = dto.difficultyMax;
    }
    const found = await this.prisma.question.findMany({
      where,
      select: { id: true, type: true, stem: true, difficulty: true },
      take: 300,
    });
    shuffle(found);
    return found.slice(0, dto.count ?? 10).map((q) => ({
      id: q.id,
      type: q.type,
      stem: q.stem,
      difficulty: q.difficulty,
      score: DEFAULT_SCORE[q.type] ?? 5,
    }));
  }

  // ---------------- 题目编排 / 计分 ----------------
  async addQuestion(paperId: string, dto: AddQuestionDto) {
    const q = await this.prisma.question.findUnique({ where: { id: dto.questionId } });
    if (!q) throw new NotFoundException('题目不存在');
    const order = (await this.nextOrder(paperId)) + 1;
    const score = dto.score ?? DEFAULT_SCORE[q.type] ?? 5;
    const pq = await this.prisma.paperQuestion.create({
      data: { paperId, questionId: q.id, order, score, snapshot: (q.content ?? undefined) as any },
    });
    await this.recompute(paperId);
    return pq;
  }

  async batchAdd(paperId: string, dto: BatchAddQuestionsDto) {
    await this.assertPaper(paperId);
    let order = await this.nextOrder(paperId);
    for (const item of dto.items) {
      const q = await this.prisma.question.findUnique({ where: { id: item.questionId } });
      if (!q) continue;
      order += 1;
      const score = item.score ?? DEFAULT_SCORE[q.type] ?? 5;
      await this.prisma.paperQuestion.create({
        data: { paperId, questionId: q.id, order, score, snapshot: (q.content ?? undefined) as any },
      });
    }
    await this.recompute(paperId);
    return this.get(paperId);
  }

  async removeQuestion(paperId: string, pqId: string) {
    await this.assertPaper(paperId);
    await this.prisma.paperQuestion.delete({ where: { id: pqId } });
    await this.recompute(paperId);
    return { ok: true };
  }

  async reorder(paperId: string, dto: ReorderDto) {
    await this.assertPaper(paperId);
    await Promise.all(
      dto.orderedIds.map((pqId, idx) =>
        this.prisma.paperQuestion.update({ where: { id: pqId }, data: { order: idx + 1 } }),
      ),
    );
    return { ok: true };
  }

  async setScore(paperId: string, pqId: string, dto: SetScoreDto) {
    await this.assertPaper(paperId);
    await this.prisma.paperQuestion.update({ where: { id: pqId }, data: { score: dto.score } });
    await this.recompute(paperId);
    return { ok: true };
  }

  // ---------------- 内部 ----------------
  private async assertPaper(id: string) {
    const p = await this.prisma.paper.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('试卷不存在');
  }

  private async nextOrder(paperId: string): Promise<number> {
    const last = await this.prisma.paperQuestion.findFirst({
      where: { paperId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return last?.order ?? 0;
  }

  private async recompute(paperId: string) {
    const agg = await this.prisma.paperQuestion.aggregate({
      where: { paperId },
      _sum: { score: true },
    });
    await this.prisma.paper.update({
      where: { id: paperId },
      data: { totalScore: agg._sum.score ?? 0 },
    });
  }
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
