import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Question } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QueryQuestionDto } from './dto/query-question.dto';
import { ensureMathDelimiters } from '../../common/tex.util';
import { LlmService } from '../llm/llm.service';
import { SettingsService } from '../settings/settings.service';
import { cropImageByBbox, isRasterImage } from '../ingest/image-crop.util';

const INCLUDE = {
  subject: { select: { id: true, name: true } },
  tags: { select: { id: true, name: true, group: true } },
  knowledgePoints: { select: { id: true, name: true, path: true } },
  createdBy: { select: { id: true, name: true, username: true } },
} as const;

/** 题目查重页：单题摘要 */
export interface DedupQuestion {
  id: string;
  type: string;
  subjectId: string | null;
  stem: string;
  sourcePapers: string[];
  sourceImagePath: string | null;
}

/** 题目查重页：一组疑似重复题 */
export interface DedupGroup {
  id: string;
  questions: DedupQuestion[];
  /** 组内两两最小 Dice 相似度（词面级，0~1；纯语义召回时为 0） */
  similarity: number;
  /** 组内两两最小语义余弦相似度（embedding，0~1；无向量时为 null） */
  semanticSimilarity: number | null;
}

/** 题目查重页：已忽略的一组（可撤销） */
export interface DedupIgnoredGroup {
  ignoreId: string;
  kind: string;
  questions: DedupQuestion[];
}

@Injectable()
export class QuestionsService {
  private readonly logger = new Logger(QuestionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly settings: SettingsService,
  ) {}

  async list(dto: QueryQuestionDto) {
    const where: any = {};
    if (dto.search) {
      where.stem = { contains: dto.search, mode: 'insensitive' };
    }
    if (dto.subjectIds) {
      const ids = String(dto.subjectIds)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length) where.subjectId = { in: ids };
    } else if (dto.subjectId) {
      where.subjectId = dto.subjectId;
    }
    if (dto.type) where.type = dto.type;
    if (dto.difficulty) where.difficulty = dto.difficulty;
    // 默认不在活跃题库呈现已归档题；归档页显式传 status=ARCHIVED 时才列出
    if (dto.status) where.status = dto.status;
    else where.status = { not: 'ARCHIVED' };
    if (dto.sourceType) where.sourceType = dto.sourceType;
    if (dto.tagId) where.tags = { some: { id: dto.tagId } };
    if (dto.knowledgePointId) {
      where.knowledgePoints = { some: { id: dto.knowledgePointId } };
    }
    if (dto.sourcePaper) {
      where.sourcePapers = { has: dto.sourcePaper };
    }
    if (dto.sourceFileId) {
      where.sourceFileId = dto.sourceFileId;
    }

    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.question.findMany({
        where,
        include: INCLUDE,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [dto.sortBy as string]: dto.order } as any,
      }),
      this.prisma.question.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const q = await this.prisma.question.findUnique({
      where: { id },
      include: {
        ...INCLUDE,
        paperQuestions: { include: { paper: { select: { id: true, title: true } } } },
      },
    });
    if (!q) throw new NotFoundException('试题不存在');
    const papers = (q.paperQuestions || [])
      .map((pq) => ({ id: pq.paper?.id, title: pq.paper?.title }))
      .filter((p) => p.id);
    return { ...q, papers };
  }

  /**
   * 题目查重：判断新录入题目是否与题库已有题目「实质同一题」。
   * 两级：① 粗筛（同学科同题型 + 题干归一化 Dice 相似度，零 token）；
   *       ② 高相似(≥0.9)直接判定；③ 否则对 top5 候选用 LLM 精判（少量 token）。
   * 命中返回 { id, sourcePapers }，未命中返回 null。
   */
  async findDuplicate(input: {
    type: string;
    stem: string;
    content?: any;
    subjectId?: string;
    /** 编辑场景传入当前题目 id，避免命中自己 */
    excludeId?: string;
    /** 快速模式：仅做确定性判定（跳过 LLM 精判），用于入库提示等低成本场景 */
    fast?: boolean;
  }): Promise<{ id: string; sourcePapers: string[] } | null> {
    const candidates = await this.prisma.question.findMany({
      where: {
        type: input.type as any,
        subjectId: input.subjectId || undefined,
        status: { not: 'ARCHIVED' },
        ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      },
      select: { id: true, stem: true, content: true, solution: true, sourcePapers: true },
      take: 300,
    });
    if (!candidates.length) return null;

    const normStem = this.normalizeText(input.stem);
    const similar = candidates
      .map((c) => ({ c, sim: this.diceCoefficient(normStem, this.normalizeText(c.stem)) }))
      .filter((x) => x.sim >= 0.55)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 5);

    if (!similar.length) return null;

    // 极高相似度：几乎逐字相同，直接判定，省 token。
    // 但客观题（选择/判断/填空）须「题干 + 选项/答案」都一致才算同一题，
    // 否则「同题干不同选项」会被误合并；题干相同但内容不同的，落到下方 AI 精判（已带 content）。
    const newSig = this.contentSignature(input.type, input.content);
    const exact = similar.find(
      (x) => x.sim >= 0.9 && newSig === this.contentSignature(input.type, x.c.content),
    );
    if (exact) return { id: exact.c.id, sourcePapers: exact.c.sourcePapers };

    // AI 精判（只对 top5 候选）；快速模式（入库提示用）跳过以省 token
    if (!input.fast) {
      const matchId = await this.llm.judgeDuplicate(
        { type: input.type, stem: input.stem, content: input.content },
        similar.map((x) => ({ id: x.c.id, stem: x.c.stem, content: x.c.content, solution: x.c.solution })),
      );
      if (matchId) {
        const matched = candidates.find((c) => c.id === matchId);
        if (matched) return { id: matched.id, sourcePapers: matched.sourcePapers };
      }
    }
    return null;
  }

  /** 归一化题干文本：去空白、去常见标点、小写（用于相似度比较） */
  private normalizeText(s: string): string {
    if (!s) return '';
    return s
      .replace(/\s+/g, '')
      .replace(/[，。、；：？！,.!?;:'"“”‘’()（）\[\]【】]/g, '')
      .toLowerCase();
  }

  /** 字符 bigram 的 Dice 相似度（0~1），对中英文题干都适用 */
  private diceCoefficient(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const bigrams = (s: string) => {
      const set = new Set<string>();
      for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
      return set;
    };
    const A = bigrams(a);
    const B = bigrams(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const g of A) if (B.has(g)) inter++;
    return (2 * inter) / (A.size + B.size);
  }

  /**
   * 客观题内容签名：选择/判断/填空据「选项+答案」生成归一化串，用于补充题干相似度的不足。
   * 两道题仅当题干相似「且」内容签名一致时才判为同一题，避免「同题干不同选项」被误合并。
   * 主观题（材料/简答/论述/阅读理解）返回空串——其区分不靠选项，仍走 AI 精判。
   */
  private contentSignature(type: string, content: any): string {
    if (!content || typeof content !== 'object') return '';
    const norm = (s: any) => (s == null ? '' : String(s).trim());
    switch (type) {
      case 'SINGLE_CHOICE':
      case 'MULTIPLE_CHOICE': {
        const opts = Array.isArray(content.options) ? content.options : [];
        const sig = opts
          .map((o: any) => `${norm(o?.key)}:${norm(o?.text)}`)
          .sort()
          .join('|');
        return `CHOICE:${sig}:${norm(content.answer)}`;
      }
      case 'TRUE_FALSE':
        return `TF:${norm(content.answer)}`;
      case 'FILL_BLANK': {
        const blanks = Array.isArray(content.blanks) ? content.blanks.map((b: any) => norm(b)).join('|') : '';
        return `FB:${blanks}`;
      }
      default:
        return '';
    }
  }

  async create(dto: CreateQuestionDto, userId?: string) {
    if (dto.subjectId) await this.assertSubject(dto.subjectId);
    const created = await this.prisma.question.create({
      data: {
        id: dto.id,
        type: dto.type,
        stem: ensureMathDelimiters(dto.stem),
        content: dto.content,
        analysis: ensureMathDelimiters(dto.analysis),
        difficulty: dto.difficulty ?? 3,
        subjectId: dto.subjectId,
        sourceType: dto.sourceType ?? 'MANUAL',
        status: dto.status ?? 'PUBLISHED',
        sourcePaperName: dto.sourcePaperName,
        sourcePapers: dto.sourcePapers ?? [],
        number: dto.number,
        groupIndex: dto.groupIndex,
        groupTitle: dto.groupTitle,
        sourceFileId: dto.sourceFileId,
        workbookId: dto.workbookId,
        sourcePath: dto.sourcePath ?? [],
        sourceImagePath: dto.sourceImagePath,
        solution: dto.solution,
        createdById: userId,
        knowledgePoints: dto.knowledgePointIds?.length
          ? { connect: dto.knowledgePointIds.map((id) => ({ id })) }
          : undefined,
        tags: dto.tagIds?.length
          ? { connect: dto.tagIds.map((id) => ({ id })) }
          : undefined,
      },
      include: INCLUDE,
    });
    // 语义向量 fire-and-forget：失败不影响建题，查重自动退回纯 Dice
    void this.refreshEmbedding(created.id);
    return created;
  }

  async update(id: string, dto: UpdateQuestionDto): Promise<Question> {
    const existing = await this.findOne(id);
    if (dto.subjectId) await this.assertSubject(dto.subjectId);
    const updated = await this.prisma.question.update({
      where: { id },
      data: {
        type: dto.type,
        stem: ensureMathDelimiters(dto.stem),
        content: dto.content,
        analysis: ensureMathDelimiters(dto.analysis),
        difficulty: dto.difficulty,
        subjectId: dto.subjectId,
        sourceType: dto.sourceType,
        status: dto.status,
        // 来源试卷名/列表：未传（undefined）则保持原值，不静默覆盖
        ...(dto.sourcePaperName !== undefined ? { sourcePaperName: dto.sourcePaperName } : {}),
        ...(dto.sourcePapers !== undefined ? { sourcePapers: dto.sourcePapers } : {}),
        // 作业本归属：未传（undefined）则保持原值
        ...(dto.workbookId !== undefined ? { workbookId: dto.workbookId } : {}),
        ...(dto.sourcePath !== undefined ? { sourcePath: dto.sourcePath } : {}),
        knowledgePoints: dto.knowledgePointIds
          ? { set: dto.knowledgePointIds.map((kid) => ({ id: kid })) }
          : undefined,
        tags: dto.tagIds ? { set: dto.tagIds.map((tid) => ({ id: tid })) } : undefined,
      },
      include: INCLUDE,
    });
    // 题干/题型/选项变了语义就变，编辑后异步刷新向量
    void this.refreshEmbedding(updated.id);
    return updated;
  }

  /**
   * 手动新建题目：先查重，命中则与已有题合并（追加来源试卷）并返回 merged 标记；
   * 未命中才真正建题。与入库合并语义一致，避免题库手工录题产生重复。
   * （入库流程 ingest.service 已自行查重+合并，故其内部仍直接调纯 create。）
   */
  // ---------------- 人工查重（题目查重页 / 归档页） ----------------

  /** 疑似重复判定阈值：同题型同学科 + 题干 Dice 相似度达到此值即视为疑似 */
  private static readonly GROUP_SIM = 0.6;

  /**
   * 语义层阈值：题干 embedding 余弦相似度达到此值也视为疑似（召回“同义不同词”）。
   * 实测 qwen3.7-text-embedding 对“同一种问法换词”的题对约 0.87，
   * 故阈值取 0.82 留余量；本系统是人工复核（误报仅人忽略、成本低），
   * 宁可放宽召回也不可漏掉真实重复。
   */
  private static readonly GROUP_SEMANTIC_SIM = 0.82;

  /** 当前 embedding 模型名（与 LlmService.embed 默认值一致，用于判断存量向量是否过期） */
  private async currentEmbeddingModel(): Promise<string> {
    const cfg = await this.settings.getGroupDecrypted('llm');
    return cfg.embeddingModel || 'qwen3.7-text-embedding';
  }

  private isObjective(type: string): boolean {
    return ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_BLANK'].includes(type);
  }

  /** 余弦相似度（两向量已同模型同维度） */
  private cosine(a: number[], b: number[]): number {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  /** 题干 embedding 输入文本：题干 + 客观题选项文本（语义与词面互补） */
  private embedTextOf(q: { stem: string; content: any }): string {
    let extra = '';
    const opts = q.content?.options;
    if (Array.isArray(opts)) {
      extra = opts.map((o: any) => o?.text ?? '').join(' ');
    }
    return `${q.stem || ''} ${extra}`.trim();
  }

  /**
   * 为指定题目生成（或刷新）题干语义向量。fire-and-forget 安全：
   * 未配置密钥/调用失败只记日志不抛错，查重自动退回纯 Dice。
   */
  async refreshEmbedding(questionId: string): Promise<void> {
    try {
      const q = await this.prisma.question.findUnique({
        where: { id: questionId },
        select: { stem: true, content: true },
      });
      if (!q) return;
      const model = await this.currentEmbeddingModel();
      const res = await this.llm.embed([this.embedTextOf(q)]);
      if (!res || res.model !== model || !res.vectors.length) return;
      const vec = res.vectors[0];
      await this.prisma.questionEmbedding.upsert({
        where: { questionId },
        create: { questionId, model: res.model, dims: vec.length, vector: vec },
        update: { model: res.model, dims: vec.length, vector: vec },
      });
    } catch (e) {
      this.logger.warn(`[embed] 题目 ${questionId} 向量生成失败: ${(e as Error).message}`);
    }
  }

  /**
   * 批量回填存量题目向量（查重页「生成语义向量」按钮）。
   * 只处理缺向量或模型已变更的题；返回 {total, generated}。
   */
  async backfillEmbeddings(): Promise<{ total: number; generated: number }> {
    const model = await this.currentEmbeddingModel();
    const qs = await this.prisma.question.findMany({
      where: { status: { not: 'ARCHIVED' } },
      select: { id: true, stem: true, content: true },
    });
    const existing = await this.prisma.questionEmbedding.findMany({
      select: { questionId: true, model: true },
    });
    const fresh = new Set(existing.filter((e) => e.model === model).map((e) => e.questionId));
    const pending = qs.filter((q) => !fresh.has(q.id));
    if (!pending.length) return { total: qs.length, generated: 0 };

    let generated = 0;
    const BATCH = 10;
    for (let i = 0; i < pending.length; i += BATCH) {
      const chunk = pending.slice(i, i + BATCH);
      const res = await this.llm.embed(chunk.map((q) => this.embedTextOf(q)));
      if (!res) break; // 密钥缺失或调用失败：停止回填，报告已生成数量
      for (let j = 0; j < chunk.length && j < res.vectors.length; j++) {
        const vec = res.vectors[j];
        await this.prisma.questionEmbedding.upsert({
          where: { questionId: chunk[j].id },
          create: { questionId: chunk[j].id, model: res.model, dims: vec.length, vector: vec },
          update: { model: res.model, dims: vec.length, vector: vec },
        });
        generated++;
      }
    }
    return { total: qs.length, generated };
  }

  /** 把一张题图追加进数组（按 cropId 去重） */
  private pushImage(arr: any[], img: any) {
    if (!img || !img.cropId) return;
    if (!arr.some((x) => x?.cropId === img.cropId)) arr.push(img);
  }

  /** 读取已忽略的重复对集合（"a|b" 无序对） */
  private async loadIgnoredPairSet(): Promise<Set<string>> {
    const rows = await this.prisma.dedupIgnore.findMany({ select: { pairs: true } });
    const set = new Set<string>();
    for (const r of rows) for (const p of (r.pairs || [])) set.add(p);
    return set;
  }

  /**
   * 扫描全库疑似重复组：同题型同学科 + 题干 Dice 相似（客观题额外要求选项/答案签名一致），
   * 已忽略的对不计入。并查集聚类为组，返回每组题摘要与最小相似度。
   */
  async scanDuplicateGroups(): Promise<DedupGroup[]> {
    const qs = await this.prisma.question.findMany({
      where: { status: { not: 'ARCHIVED' } },
      select: {
        id: true, type: true, subjectId: true, stem: true,
        content: true, sourcePapers: true, sourceImagePath: true,
      },
    });
    const ignored = await this.loadIgnoredPairSet();
    // 语义层：取当前模型的存量向量（缺失的题退回纯 Dice），维度以当前模型为准
    const embedModel = await this.currentEmbeddingModel();
    const embedRows = await this.prisma.questionEmbedding.findMany({
      where: { model: embedModel },
      select: { questionId: true, dims: true, vector: true },
    });
    const vecMap = new Map<string, number[]>(embedRows.map((r) => [r.questionId, r.vector as unknown as number[]]));
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let r = x;
      while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
      if (!parent.has(r)) parent.set(r, r);
      let cur = x;
      while (parent.has(cur) && parent.get(cur) !== r) {
        const n = parent.get(cur)!;
        parent.set(cur, r);
        cur = n;
      }
      return r;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    const simMap = new Map<string, number>();
    const semMap = new Map<string, number>();
    for (let i = 0; i < qs.length; i++) {
      for (let j = i + 1; j < qs.length; j++) {
        const A = qs[i];
        const B = qs[j];
        if (A.type !== B.type) continue;
        if ((A.subjectId ?? null) !== (B.subjectId ?? null)) continue;
        // 客观题内容签名是硬门禁：签名不一致无论 Dice/语义多高都不算重复
        if (this.isObjective(A.type) &&
          this.contentSignature(A.type, A.content) !== this.contentSignature(B.type, B.content)) continue;
        const sim = this.diceCoefficient(this.normalizeText(A.stem), this.normalizeText(B.stem));
        const va = vecMap.get(A.id);
        const vb = vecMap.get(B.id);
        const sem = va && vb && va.length === vb.length ? this.cosine(va, vb) : null;
        // 二层召回：词面 Dice 达标 或 语义余弦达标（同义不同词）
        const hit = sim >= QuestionsService.GROUP_SIM ||
          (sem !== null && sem >= QuestionsService.GROUP_SEMANTIC_SIM);
        if (!hit) continue;
        const k = pairKey(A.id, B.id);
        if (ignored.has(k)) continue;
        union(A.id, B.id);
        simMap.set(k, sim);
        if (sem !== null) semMap.set(k, sem);
      }
    }
    const groups = new Map<string, string[]>();
    for (const q of qs) {
      const root = find(q.id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(q.id);
    }
    const out: DedupGroup[] = [];
    for (const ids of groups.values()) {
      if (ids.length < 2) continue;
      const items = ids.map((id) => qs.find((q) => q.id === id)!).filter(Boolean);
      const questions: DedupQuestion[] = items.map((q) => ({
        id: q.id, type: q.type, subjectId: q.subjectId,
        stem: q.stem, sourcePapers: (q.sourcePapers as string[]) ?? [],
        sourceImagePath: (q.sourceImagePath as string) ?? null,
      }));
      let minSim = 1;
      let minSem: number | null = null;
      let anySem = false;
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const k = pairKey(ids[i], ids[j]);
          minSim = Math.min(minSim, simMap.get(k) ?? 1);
          const s = semMap.get(k);
          if (s !== undefined) {
            anySem = true;
            minSem = minSem === null ? s : Math.min(minSem, s);
          }
        }
      out.push({
        id: ids[0],
        questions,
        similarity: Number(minSim.toFixed(2)),
        semanticSimilarity: anySem ? Number(minSem!.toFixed(2)) : null,
      });
    }
    return out;
  }

  /** 侧边栏红点：未处理（未忽略）的疑似重复组数 */
  async countDedupGroups(): Promise<{ groups: number }> {
    const groups = await this.scanDuplicateGroups();
    return { groups: groups.length };
  }

  /** 已忽略的组（供「显示已忽略 / 撤销忽略」） */
  async listIgnoredGroups(): Promise<DedupIgnoredGroup[]> {
    const rows = await this.prisma.dedupIgnore.findMany({ orderBy: { createdAt: 'desc' } });
    if (!rows.length) return [];
    const ids = Array.from(new Set(rows.flatMap((r) => r.questionIds)));
    const qs = await this.prisma.question.findMany({
      where: { id: { in: ids }, status: { not: 'ARCHIVED' } },
      select: { id: true, type: true, subjectId: true, stem: true, sourcePapers: true, sourceImagePath: true },
    });
    const map = new Map(qs.map((q) => [q.id, q]));
    const out: DedupIgnoredGroup[] = [];
    for (const r of rows) {
      const questions: DedupQuestion[] = r.questionIds
        .map((id) => map.get(id))
        .filter((q): q is NonNullable<typeof q> => !!q)
        .map((q) => ({
          id: q.id, type: q.type, subjectId: q.subjectId, stem: q.stem,
          sourcePapers: (q.sourcePapers as string[]) ?? [], sourceImagePath: (q.sourceImagePath as string) ?? null,
        }));
      if (questions.length >= 2) out.push({ ignoreId: r.id, kind: r.kind, questions });
    }
    return out;
  }

  /** 整组忽略：展开为组内所有两两对，删除即撤销 */
  async ignoreGroup(questionIds: string[]): Promise<{ ignoreId: string }> {
    const ids = Array.from(new Set((questionIds || []).filter(Boolean)));
    if (ids.length < 2) throw new BadRequestException('忽略组至少需要两道题');
    const pairs = combinations(ids).map(([a, b]) => pairKey(a, b));
    const row = await this.prisma.dedupIgnore.create({
      data: { kind: 'GROUP', questionIds: ids, pairs },
    });
    return { ignoreId: row.id };
  }

  /** 逐对忽略 */
  async ignorePair(a: string, b: string): Promise<{ ignoreId: string }> {
    if (a === b) throw new BadRequestException('不能忽略自身');
    const row = await this.prisma.dedupIgnore.create({
      data: { kind: 'PAIR', questionIds: [a, b], pairs: [pairKey(a, b)] },
    });
    return { ignoreId: row.id };
  }

  /** 撤销忽略 */
  async unignore(ignoreId: string): Promise<{ ok: true }> {
    await this.prisma.dedupIgnore.delete({ where: { id: ignoreId } });
    return { ok: true };
  }

  /**
   * 合并：把 absorbedIds 中的题标记 ARCHIVED（不在活跃题库呈现，归档页可见、可恢复），
   * 把它们的来源试卷 / 标签 / 知识点 / 试卷裁切原图 并入 keptId。
   * 记录 DedupMerge 日志，可整体撤销（撤销合并）。
   */
  async mergeQuestions(
    input: { keptId: string; absorbedIds: string[] },
    userId?: string,
  ): Promise<{ keptId: string; archived: string[]; mergeId: string }> {
    const keptId = input.keptId;
    const absorbedIds = Array.from(new Set((input.absorbedIds || []).filter(Boolean)));
    if (!keptId) throw new BadRequestException('请选择保留的主题');
    if (!absorbedIds.length) throw new BadRequestException('请选择要合并的题');
    if (absorbedIds.includes(keptId)) throw new BadRequestException('保留题不能在被合并列表中');

    const [kept, absorbed] = await Promise.all([
      this.prisma.question.findUnique({
        where: { id: keptId },
        include: { tags: { select: { id: true } }, knowledgePoints: { select: { id: true } } },
      }),
      this.prisma.question.findMany({
        where: { id: { in: absorbedIds } },
        include: { tags: { select: { id: true } }, knowledgePoints: { select: { id: true } } },
      }),
    ]);
    if (!kept) throw new NotFoundException('保留题不存在');
    if (absorbed.length !== absorbedIds.length) throw new NotFoundException('部分被合并题不存在');

    const keptContent: Record<string, any> = { ...(kept.content as Record<string, any> | null ?? {}) };
    const keptImages: any[] = Array.isArray(keptContent.images) ? [...keptContent.images] : [];
    const keptSources = new Set<string>([...(kept.sourcePapers ?? [])]);
    if (kept.sourcePaperName) keptSources.add(kept.sourcePaperName);
    const keptTagIds = new Set<string>(kept.tags.map((t) => t.id));
    const keptKpIds = new Set<string>(kept.knowledgePoints.map((k) => k.id));

    const absorbedBackup: any[] = [];
    for (const q of absorbed) {
      const qContent: Record<string, any> = { ...(q.content as Record<string, any> | null ?? {}) };
      if (q.sourcePaperName) keptSources.add(q.sourcePaperName);
      for (const s of (q.sourcePapers ?? [])) keptSources.add(s);
      for (const t of q.tags) keptTagIds.add(t.id);
      for (const k of q.knowledgePoints) keptKpIds.add(k.id);
      const cropFromSrc = cropIdFromPath(q.sourceImagePath as string | null);
      if (cropFromSrc) {
        // 合并来源原图：标注其来源试卷，详情页左侧与「裁切原图」同款大图展示（而非题图）
        const paper = q.sourcePaperName || (Array.isArray(q.sourcePapers) && q.sourcePapers[0]) || undefined;
        this.pushImage(keptImages, { cropId: cropFromSrc, label: '试卷裁切原图', paper, kind: 'merged' });
      }
      const qImages = Array.isArray(qContent.images) ? (qContent.images as any[]) : [];
      for (const img of qImages) this.pushImage(keptImages, img);
      absorbedBackup.push({
        id: q.id,
        status: q.status,
        sourceImagePath: q.sourceImagePath ?? null,
        images: qImages,
      });
    }

    const keptBackup = {
      sourcePapers: kept.sourcePapers ?? [],
      sourcePaperName: kept.sourcePaperName ?? null,
      tagIds: kept.tags.map((t) => t.id),
      knowledgePointIds: kept.knowledgePoints.map((k) => k.id),
      sourceImagePath: kept.sourceImagePath ?? null,
      images: keptImages.length ? keptImages : (Array.isArray(keptContent.images) ? keptContent.images : []),
    };

    const mergeId = await this.prisma.$transaction(async (tx) => {
      await tx.question.update({
        where: { id: keptId },
        data: {
          sourcePapers: Array.from(keptSources),
          tags: { set: Array.from(keptTagIds).map((id) => ({ id })) },
          knowledgePoints: { set: Array.from(keptKpIds).map((id) => ({ id })) },
          content: { ...keptContent, images: keptImages },
        },
      });
      await tx.question.updateMany({ where: { id: { in: absorbedIds } }, data: { status: 'ARCHIVED' } });
      const merge = await tx.dedupMerge.create({
        data: {
          keptId,
          absorbedIds,
          backup: { kept: keptBackup, absorbed: absorbedBackup } as any,
          createdById: userId,
        },
      });
      return merge.id;
    });

    return { keptId, archived: absorbedIds, mergeId };
  }

  /** 撤销合并：恢复保留题的来源/标签/知识点/图片，并把被吸收的题恢复状态 */
  async undoMerge(mergeId: string): Promise<{ keptId: string; restored: string[] }> {
    const merge = await this.prisma.dedupMerge.findUnique({ where: { id: mergeId } });
    if (!merge) throw new NotFoundException('合并记录不存在');
    const backup = merge.backup as any;
    const keptB = backup?.kept ?? {};
    const absorbedB: any[] = backup?.absorbed ?? [];

    await this.prisma.$transaction(async (tx) => {
      const keptNow = await tx.question.findUnique({ where: { id: merge.keptId }, select: { content: true } });
      const keptContent = { ...(keptNow?.content as Record<string, any> | null ?? {}), images: keptB.images ?? [] };
      await tx.question.update({
        where: { id: merge.keptId },
        data: {
          sourcePapers: keptB.sourcePapers ?? [],
          sourcePaperName: keptB.sourcePaperName ?? undefined,
          tags: { set: (keptB.tagIds ?? []).map((id: string) => ({ id })) },
          knowledgePoints: { set: (keptB.knowledgePointIds ?? []).map((id: string) => ({ id })) },
          sourceImagePath: keptB.sourceImagePath ?? undefined,
          content: keptContent,
        },
      });
      for (const a of absorbedB) {
        const now = await tx.question.findUnique({ where: { id: a.id }, select: { content: true } });
        const content = { ...(now?.content as Record<string, any> | null ?? {}), images: a.images ?? [] };
        await tx.question.update({
          where: { id: a.id },
          data: {
            status: a.status ?? 'PUBLISHED',
            sourceImagePath: a.sourceImagePath ?? undefined,
            content,
          },
        });
      }
      await tx.dedupMerge.delete({ where: { id: mergeId } });
    });
    return { keptId: merge.keptId, restored: absorbedB.map((a) => a.id) };
  }

  /** 按被吸收题 id 反查合并记录并撤销（归档页「恢复」用，先试撤销合并再退回归档） */
  async undoMergeByQuestion(absorbedId: string): Promise<{ undone: boolean; keptId?: string }> {
    const merge = await this.prisma.dedupMerge.findFirst({ where: { absorbedIds: { has: absorbedId } } });
    if (!merge) return { undone: false };
    await this.undoMerge(merge.id);
    return { undone: true, keptId: merge.keptId };
  }

  /**
   * 详情页「合并来的题目」：按合并记录反查某保留题名下被并入的题（实时取数，非快照），
   * 供详情页展示各被合并题的识别内容（题干/选项/答案）与 AI 解答。撤销合并后自动消失。
   */
  async listMergedQuestions(keptId: string) {
    const merges = await this.prisma.dedupMerge.findMany({
      where: { keptId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, absorbedIds: true, createdAt: true },
    });
    const ids = Array.from(new Set(merges.flatMap((m) => m.absorbedIds)));
    if (!ids.length) return [];
    const qs = await this.prisma.question.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        type: true,
        stem: true,
        content: true,
        analysis: true,
        solution: true,
        status: true,
        sourcePaperName: true,
        sourcePapers: true,
        sourceImagePath: true,
      },
    });
    // 只保留确实仍处于归档态（即仍是本保留题的合并项）的题，避免已撤销/恢复的脏数据
    const archived = qs.filter((q) => q.status === 'ARCHIVED');
    // 按合并时间先后排序展示（先并入的在前）
    const order = new Map(ids.map((id, i) => [id, i]));
    return archived.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  /** 归档页：恢复（取消归档），回到活跃题库 */
  async restoreQuestion(id: string): Promise<Question> {
    await this.findOne(id);
    return this.prisma.question.update({
      where: { id },
      data: { status: 'PUBLISHED' },
      include: INCLUDE,
    });
  }


  /** 合并时往已有题追加来源试卷条目（去重），返回更新后的 sourcePapers */
  private async appendSourcePapers(questionId: string, add: string[]): Promise<string[]> {
    const q = await this.prisma.question.findUnique({ where: { id: questionId }, select: { sourcePapers: true } });
    const cur: string[] = Array.isArray(q?.sourcePapers) ? (q!.sourcePapers as unknown as string[]) : [];
    const next = [...cur];
    for (const s of add) if (s && !next.includes(s)) next.push(s);
    await this.prisma.question.update({ where: { id: questionId }, data: { sourcePapers: next } });
    return next;
  }

  /**
   * 试卷侧边栏「添加题目到试卷」：把题库中已有题目「追加归属」到某试卷。
   * 仅把试卷名写入 question.sourcePapers（去重，不新建记录、不改题号），
   * 题目同时保留在原有试卷中（按用户确认的追加语义）。
   */
  async addToPaper(paperName: string, questionIds: string[]): Promise<{ added: number }> {
    const name = paperName?.trim();
    if (!name) throw new BadRequestException('试卷名为空');
    const unique = Array.from(new Set((questionIds || []).filter(Boolean)));
    for (const id of unique) {
      await this.appendSourcePapers(id, [name]);
    }
    return { added: unique.length };
  }

  /** 从 sourcePapers 移除指定试卷名（安全去重），返回剩余列表 */
  private async removeSourcePapers(questionId: string, remove: string[]): Promise<string[]> {
    const q = await this.prisma.question.findUnique({ where: { id: questionId }, select: { sourcePapers: true } });
    const cur: string[] = Array.isArray(q?.sourcePapers) ? (q!.sourcePapers as unknown as string[]) : [];
    const rm = new Set(remove);
    const next = cur.filter((s) => !rm.has(s));
    await this.prisma.question.update({ where: { id: questionId }, data: { sourcePapers: next } });
    return next;
  }

  /**
   * 试卷侧边栏「从小卷移除题目」：把题目的 sourcePapers 中剔除指定试卷名（不删除题目本身，
   * 题目仍保留在其它试卷中）。供编辑试卷页小题右侧 × 删除使用。
   */
  async removeFromPaper(paperName: string, questionIds: string[]): Promise<{ removed: number }> {
    const name = paperName?.trim();
    if (!name) throw new BadRequestException('试卷名为空');
    const unique = Array.from(new Set((questionIds || []).filter(Boolean)));
    for (const id of unique) {
      await this.removeSourcePapers(id, [name]);
    }
    return { removed: unique.length };
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.question.delete({ where: { id } });
  }

  /**
   * 批量删除题目。
   * - 入参去重并校验为有效字符串数组。
   * - 受保护题目（已被考试作答引用，AnswerRecord.questionId 外键 ON DELETE RESTRICT）
   *   不可删除，否则会破坏考试记录；这类题目跳过并随结果返回，避免整批失败。
   * - 其余题目用 deleteMany 一次删除（关联标签/知识点多对多、PaperQuestion/OcrItem 外键
   *   SET NULL 由数据库级联处理）。
   */
  async batchRemove(ids: string[]): Promise<{ deleted: number; protected: string[] }> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('请选择要删除的题目');
    }
    const uniqueIds = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.length > 0)));
    if (uniqueIds.length === 0) {
      throw new BadRequestException('请选择要删除的题目');
    }

    // 找出已被考试作答引用的题目（受保护，不可删）
    const protectedRows = await this.prisma.answerRecord.findMany({
      where: { questionId: { in: uniqueIds } },
      select: { questionId: true },
      distinct: ['questionId'],
    });
    const protectedIds = new Set(protectedRows.map((r) => r.questionId));
    const deletable = uniqueIds.filter((id) => !protectedIds.has(id));

    let deleted = 0;
    if (deletable.length > 0) {
      const res = await this.prisma.question.deleteMany({
        where: { id: { in: deletable } },
      });
      deleted = res.count;
    }
    return { deleted, protected: Array.from(protectedIds) };
  }

  /**
   * 原子更新题内图片（采用已框题图 / 本地上传 / 从试卷页裁切）。
   * 服务端校验 cropId 格式并去重，避免前端各自拼 content.images 再整体回传。
   */
  async setImages(
    id: string,
    images: Array<{ cropId: string; label?: string; kind?: string; paper?: string }>,
  ) {
    const q = await this.findOne(id);
    const content: Record<string, any> = { ...(q.content as Record<string, any> | null ?? {}) };
    const valid = Array.isArray(images)
      ? images
          .filter((im) => im && typeof im.cropId === 'string' && /^[a-zA-Z0-9_-]+$/.test(im.cropId))
          .map((im) => {
            const out: any = {
              cropId: im.cropId,
              label: typeof im.label === 'string' && im.label ? im.label : '题内图片',
            };
            // 保留合并来源原图的元信息（kind/paper），其余题图不携带不影响
            if (im.kind) out.kind = im.kind;
            if (im.paper) out.paper = im.paper;
            return out;
          })
      : [];
    const seen = new Set<string>();
    const dedup = valid.filter((im) => (seen.has(im.cropId) ? false : (seen.add(im.cropId), true)));
    if (dedup.length) content.images = dedup;
    else delete content.images;
    return this.prisma.question.update({ where: { id }, data: { content }, include: INCLUDE });
  }

  /**
   * 入库后统一触发 AI 解答（解析 + 完整步骤 + 选择题/填空题答案）。
   * 录入任务阶段只识别题目、不解答；解答由题库侧按钮显式触发，避免耦合录入流程。
   * 未配置 LLM 密钥时返回 null（调用方提示）；LLM 调用异常由 LlmService 抛出明确错误。
   */
  async solveQuestion(id: string): Promise<{ analysis: string; solution: string; model: string } | null> {
    const q = await this.prisma.question.findUnique({ where: { id } });
    if (!q) throw new NotFoundException('试题不存在');
    this.logger.log(`[solveQuestion] 开始 id=${id} type=${q.type}`);
    // 仪表盘 AI 工作进度：记录解答任务（jobId 存题目 id，进度条目可点击跳转题库详情）
    const task = await this.prisma.aiTaskLog.create({
      data: {
        type: 'solve',
        title: q.stem ? q.stem.slice(0, 30) : id,
        status: 'RUNNING',
        percent: 0,
        jobId: q.id,
      },
    });
    const taskFail = (msg: string) =>
      this.prisma.aiTaskLog
        .update({ where: { id: task.id }, data: { status: 'FAILED', message: msg?.slice(0, 200) } })
        .catch(() => undefined);
    let res: Awaited<ReturnType<LlmService['solve']>>;
    try {
      res = await this.llm.solve({
        type: q.type,
        stem: q.stem,
        content: q.content as Record<string, any>,
        difficulty: q.difficulty,
      });
    } catch (e) {
      await taskFail((e as Error).message);
      throw e;
    }
    if (!res) {
      await taskFail('未配置文本模型密钥（系统设置 → 文本模型），跳过 AI 解答');
      return null;
    }
    await this.prisma.aiTaskLog
      .update({ where: { id: task.id }, data: { percent: 40, message: '生成解答中…' } })
      .catch(() => undefined);
    const analysis = ensureMathDelimiters(res.analysis);
    const solution = ensureMathDelimiters(res.solution);

    // 把选择题/判断题/填空题的答案回填进 content（录入阶段未写答案，此处补全）
    const content: Record<string, any> = { ...(q.content as Record<string, any> | null ?? {}) };
    if ((q.type === 'SINGLE_CHOICE' || q.type === 'MULTIPLE_CHOICE') && res.answer) {
      content.answer = res.answer;
      if (Array.isArray(content.options)) {
        const keys: string[] = res.answer.toUpperCase().match(/[A-Z]/g) ?? [];
        content.options = (content.options as any[]).map((o: any) => ({
          ...o,
          correct: keys.includes(String(o.key ?? '').toUpperCase()),
        }));
      }
    } else if (q.type === 'TRUE_FALSE' && res.answer) {
      const a = res.answer.trim().toUpperCase();
      content.answer = ['T', 'TRUE', '对', '正确', '√'].includes(a)
        ? 'T'
        : ['F', 'FALSE', '错', '错误', '×'].includes(a)
          ? 'F'
          : a;
    } else if (q.type === 'FILL_BLANK' && res.blanks?.length) {
      content.blanks = res.blanks.map((b: string) => ensureMathDelimiters(b));
    } else if (q.type === 'READING_COMPREHENSION') {
      // 阅读理解大题：逐小题回填答案（选择类小题高亮正确选项，简答类小题填答案）
      const subs = Array.isArray(content.subQuestions) ? (content.subQuestions as any[]) : [];
      // 优先用结构化 subAnswers；LLM 偶发把答案直接写在 solution 里（"1. A\n2. C..."），此时从 solution 兜底解析
      const subAnswers =
        res.subAnswers && res.subAnswers.length
          ? res.subAnswers
          : res.solution
            ? this.parseSubAnswersFromText(res.solution, subs.length)
            : [];
      for (const sa of subAnswers) {
        const sub = subs[sa.index - 1];
        if (!sub || !sa.answer) continue;
        const subType = sub.type as string | undefined;
        if (subType === 'SINGLE_CHOICE' || subType === 'MULTIPLE_CHOICE') {
          sub.answer = sa.answer;
          const keys: string[] = sa.answer.toUpperCase().match(/[A-Z]/g) ?? [];
          if (Array.isArray(sub.options)) {
            sub.options = sub.options.map((o: any) => ({
              ...o,
              correct: keys.includes(String(o.key ?? '').toUpperCase()),
            }));
          }
        } else {
          sub.answer = ensureMathDelimiters(sa.answer);
        }
      }
    } else if (q.type === 'MATERIAL' || q.type === 'SHORT_ANSWER' || q.type === 'ESSAY') {
      // 材料题 / 简答 / 论述：逐小题回填参考答案；无小题时用 answer 字段
      const subs = Array.isArray(content.subQuestions) ? (content.subQuestions as any[]) : [];
      if (subs.length) {
        const subAnswers =
          res.subAnswers && res.subAnswers.length
            ? res.subAnswers
            : res.solution
              ? this.parseSubAnswersFromText(res.solution, subs.length)
              : [];
        for (const sa of subAnswers) {
          const sub = subs[sa.index - 1];
          if (!sub || !sa.answer) continue;
          sub.answer = ensureMathDelimiters(sa.answer);
        }
      } else if (res.answer) {
        content.answer = ensureMathDelimiters(res.answer);
      }
    }

    await this.prisma.question.update({
      where: { id },
      data: {
        analysis: analysis || q.analysis,
        solution: solution || undefined,
        content,
        llmModel: res.model,
        aiGenerated: true,
      },
    });
    this.logger.log(`[solveQuestion] 完成 id=${id} model=${res.model}`);
    await this.prisma.aiTaskLog
      .update({ where: { id: task.id }, data: { status: 'DONE', percent: 100, message: '解答完成' } })
      .catch(() => undefined);
    return { analysis: analysis || q.analysis || '', solution: solution || '', model: res.model };
  }

  /** 题目来源整页原图（OCR 录入时记录的试卷图），供详情页按 bbox 裁切展示 */
  async getSourceImage(id: string): Promise<{ buffer: Buffer; mime: string }> {
    const q = await this.prisma.question.findUnique({
      where: { id },
      select: { sourceImagePath: true },
    });
    if (!q || !q.sourceImagePath) {
      throw new NotFoundException('该题目无来源原图（非图片 OCR 录入）');
    }
    const ext = path.extname(q.sourceImagePath).toLowerCase();
    const mime =
      ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : 'application/octet-stream';
    const buffer = await fs.readFile(q.sourceImagePath);
    return { buffer, mime };
  }

  /** 题内图片（OCR 识别题图后裁切保存于 UPLOAD_DIR/crops/{cropId}.png） */
  async getFigureImage(cropId: string): Promise<{ buffer: Buffer; mime: string }> {
    if (!cropId || !/^[a-zA-Z0-9_-]+$/.test(cropId)) {
      throw new NotFoundException('无效的图片标识');
    }
    const dir = process.env.UPLOAD_DIR
      ? path.join(process.env.UPLOAD_DIR, 'ingest', 'crops')
      : path.join(process.cwd(), 'uploads', 'ingest', 'crops');
    const filePath = path.join(dir, `${cropId}.png`);
    try {
      const buffer = await fs.readFile(filePath);
      return { buffer, mime: 'image/png' };
    } catch {
      throw new NotFoundException('题内图片不存在');
    }
  }

  /** 题图：本地上传（题库/审阅台「+图片」→ 上传文件），保存到 crops/{cropId}.png */
  async uploadFigure(file: any): Promise<{ cropId: string }> {
    if (!file?.buffer || !file.buffer.length) throw new BadRequestException('缺少图片文件');
    const cropId = randomUUID();
    const dir = process.env.UPLOAD_DIR
      ? path.join(process.env.UPLOAD_DIR, 'ingest', 'crops')
      : path.join(process.cwd(), 'uploads', 'ingest', 'crops');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${cropId}.png`), file.buffer);
    return { cropId };
  }

  /** 题图：从试卷页按 bbox 裁切（「+图片」→ 从 PDF/图片页选择框选区域） */
  async figureFromPage(dto: { pageId: string; bbox: number[] }): Promise<{ cropId: string }> {
    const page = await this.prisma.ingestPage.findUnique({ where: { id: dto.pageId } });
    if (!page) throw new NotFoundException('页面不存在');
    const bb = Array.isArray(dto.bbox) && dto.bbox.length === 4 ? (dto.bbox as [number, number, number, number]) : null;
    if (!bb) throw new BadRequestException('bbox 格式应为 [x0,y0,x1,y1]（0-1 归一化）');
    if (!isRasterImage(page.imagePath)) throw new BadRequestException('仅支持从图片页面裁切（PDF 页请先转图）');
    const cropId = randomUUID();
    const dir = process.env.UPLOAD_DIR
      ? path.join(process.env.UPLOAD_DIR, 'ingest', 'crops')
      : path.join(process.cwd(), 'uploads', 'ingest', 'crops');
    await fs.mkdir(dir, { recursive: true });
    await cropImageByBbox(page.imagePath, bb, path.join(dir, `${cropId}.png`));
    return { cropId };
  }

  private async assertSubject(id: string) {
    const s = await this.prisma.subject.findUnique({ where: { id } });
    if (!s) throw new BadRequestException('学科不存在');
  }

  /**
   * 从 LLM 的 solution 文本兜底解析阅读理解各小题答案。
   * 常见形式："1. A\n2. C\n3. D"（选择）或 "1. 参考答案文字"（简答）。
   * 仅提取题号范围内的条目，返回 { index, answer }（index 从 1 起）。
   */
  private parseSubAnswersFromText(text: string, total: number): Array<{ index: number; answer: string }> {
    const out: Array<{ index: number; answer: string }> = [];
    if (!text) return out;
    const lines = text.split(/\n+/);
    for (const line of lines) {
      // 匹配 "1. A" / "2、AB" / "3: C" / "4) D"（选择题字母），或 "1. 参考答案文字"（简答）
      const m = line.match(/^\s*(\d{1,2})\s*[.、:：)]\s*(\S.*)$/);
      if (!m) continue;
      const idx = Number(m[1]);
      const ans = m[2].trim();
      if (!Number.isFinite(idx) || idx < 1 || idx > total || !ans) continue;
      out.push({ index: idx, answer: ans });
    }
    return out;
  }
}

// ----------------------------- 模块级辅助（查重） -----------------------------

/** 无序对 key：用于忽略集合与去重判定 */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** 所有两两组合 */
function combinations(ids: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]]);
  return out;
}

/**
 * 从题目来源图路径抽取 cropId：仅当路径位于 crops/ 目录下（单题裁切图），
 * 其余（整页图等）返回 null，避免把非裁切图误当作题图。
 */
function cropIdFromPath(p?: string | null): string | null {
  if (!p || !/crops\//i.test(p)) return null;
  const base = p.split(/[\\/]/).pop() || '';
  const m = /^(.+)\.(png|jpe?g)$/i.exec(base);
  return m ? m[1] : null;
}
