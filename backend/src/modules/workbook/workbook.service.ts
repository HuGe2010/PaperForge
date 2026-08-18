import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** 章节裸数据（构树 / 算路径用） */
interface SectionRow {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  createdAt?: Date;
}

/** 事务客户端与 PrismaService 的公共子集 */
type Db = Omit<PrismaService, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * 作业本模块：独立实体 Workbook + 任意多级章节树 WorkbookSection。
 *
 * 归属模型（重要）：
 *   题目归属 = Question.workbookId + Question.workbookSectionId（外键，唯一真相）。
 *   workbookSectionId 为 null 表示落在「作业本根」（已进作业本但未分章节）。
 *   Question.sourcePath 只是派生的展示用名称路径 [作业本名, 章节名, ...]，
 *   在作业本改名 / 章节改名 / 章节移动 / 归属变更后由 resyncSourcePaths 统一重算。
 *
 * 历史缺陷：早期版本用 sourcePath 名称快照判定归属，重命名或移动后题目在任何章节都匹配不到，
 * 表现为「题目凭空消失」。改为外键后重命名/移动不再影响归属。
 */
@Injectable()
export class WorkbookService {
  private readonly logger = new Logger(WorkbookService.name);

  constructor(private readonly prisma: PrismaService) {}

  // =============================================================
  // 内部工具
  // =============================================================

  /** 一次性载入作业本的全部章节（避免逐节点查询造成 N+1） */
  private async loadSections(db: Db, workbookId: string): Promise<SectionRow[]> {
    return db.workbookSection.findMany({
      where: { workbookId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, parentId: true, order: true, createdAt: true },
    });
  }

  /** 根→叶的章节名称路径；带访问集合防御脏数据成环导致死循环 */
  private pathOf(map: Map<string, SectionRow>, sectionId: string): string[] {
    const names: string[] = [];
    const seen = new Set<string>();
    let cur = map.get(sectionId);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      names.unshift(cur.name);
      cur = cur.parentId ? map.get(cur.parentId) : undefined;
    }
    return names;
  }

  /** 某节点及其全部后代 id（含自身），用于删除与防环校验 */
  private subtreeIds(sections: SectionRow[], rootId: string): string[] {
    const childrenMap = new Map<string, string[]>();
    for (const s of sections) {
      const key = s.parentId ?? '__root__';
      if (!childrenMap.has(key)) childrenMap.set(key, []);
      childrenMap.get(key)!.push(s.id);
    }
    const out: string[] = [];
    const stack = [rootId];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      out.push(cur);
      for (const c of childrenMap.get(cur) || []) stack.push(c);
    }
    return out;
  }

  private buildTree(sections: SectionRow[], counts: Map<string | null, number>): any[] {
    const nodes = new Map<string, any>();
    for (const s of sections) {
      nodes.set(s.id, { ...s, children: [], questionCount: counts.get(s.id) ?? 0, subtreeCount: 0 });
    }
    const roots: any[] = [];
    for (const s of sections) {
      const node = nodes.get(s.id)!;
      const parent = s.parentId ? nodes.get(s.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    // 自底向上累计「含子孙题数」，让树上每一层都能显示真实容量
    const accumulate = (node: any): number => {
      let sum = node.questionCount;
      for (const c of node.children) sum += accumulate(c);
      node.subtreeCount = sum;
      return sum;
    };
    for (const r of roots) accumulate(r);
    return roots;
  }

  /** 同级同名校验：路径展示与人工识别都依赖名称，同级重名会造成歧义 */
  private async assertNoSiblingName(
    db: Db,
    workbookId: string,
    parentId: string | null,
    name: string,
    excludeId?: string,
  ) {
    const dup = await db.workbookSection.findFirst({
      where: {
        workbookId,
        parentId,
        name,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (dup) throw new BadRequestException(`同级下已有同名章节「${name}」，请换个名称`);
  }

  /**
   * 重算作业本下全部题目的 sourcePath（展示字段），使其与归属外键严格一致。
   * 作业本改名、章节改名、章节移动、题目归属变更后都必须调用。
   */
  private async resyncSourcePaths(db: Db, workbookId: string): Promise<void> {
    const wb = await db.workbook.findUnique({ where: { id: workbookId }, select: { name: true } });
    if (!wb) return;
    const sections = await this.loadSections(db, workbookId);
    const map = new Map(sections.map((s) => [s.id, s]));

    // 作业本根：仅 [作业本名]
    await db.question.updateMany({
      where: { workbookId, workbookSectionId: null },
      data: { sourcePath: [wb.name] },
    });
    // 各章节：[作业本名, ...章节全路径]（章节数量级很小，逐节点 updateMany 可接受）
    for (const s of sections) {
      await db.question.updateMany({
        where: { workbookId, workbookSectionId: s.id },
        data: { sourcePath: [wb.name, ...this.pathOf(map, s.id)] },
      });
    }
  }

  /** 把一批题目彻底移出作业本（回到题库，题目本身不删） */
  private async releaseQuestions(db: Db, where: Prisma.QuestionWhereInput): Promise<number> {
    const res = await db.question.updateMany({
      where,
      data: { workbookId: null, workbookSectionId: null, sourcePath: [] },
    });
    return res.count;
  }

  private async assertSubject(db: Db, id: string) {
    const s = await db.subject.findUnique({ where: { id } });
    if (!s) throw new BadRequestException('学科不存在');
  }

  /** 取作业本（不含树），不存在直接 404 */
  private async assertWorkbook(db: Db, id: string) {
    const wb = await db.workbook.findUnique({ where: { id } });
    if (!wb) throw new NotFoundException('作业本不存在');
    return wb;
  }

  /** 取章节并校验归属于该作业本，避免跨作业本越权操作 */
  private async assertSection(db: Db, workbookId: string, sectionId: string) {
    const section = await db.workbookSection.findUnique({ where: { id: sectionId } });
    if (!section || section.workbookId !== workbookId) throw new NotFoundException('章节不存在或不属于该作业本');
    return section;
  }

  // =============================================================
  // 作业本 CRUD
  // =============================================================

  async create(dto: { name: string; subjectId?: string; description?: string }, userId?: string) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('作业本名称不能为空');
    if (dto.subjectId) await this.assertSubject(this.prisma, dto.subjectId);
    return this.prisma.workbook.create({
      data: {
        name,
        subjectId: dto.subjectId || undefined,
        description: dto.description?.trim() || undefined,
        createdById: userId,
      },
    });
  }

  async list() {
    const [workbooks, qCounts, sCounts] = await Promise.all([
      this.prisma.workbook.findMany({
        orderBy: { createdAt: 'desc' },
        include: { subject: { select: { id: true, name: true } } },
      }),
      this.prisma.question.groupBy({
        by: ['workbookId'],
        where: { workbookId: { not: null } },
        _count: true,
      }),
      this.prisma.workbookSection.groupBy({ by: ['workbookId'], _count: true }),
    ]);
    const qMap = new Map<string, number>((qCounts as any[]).map((c) => [c.workbookId, c._count]));
    const sMap = new Map<string, number>((sCounts as any[]).map((c) => [c.workbookId, c._count]));
    return workbooks.map((w) => ({
      ...w,
      questionCount: qMap.get(w.id) ?? 0,
      sectionCount: sMap.get(w.id) ?? 0,
    }));
  }

  async get(id: string) {
    const wb = await this.prisma.workbook.findUnique({
      where: { id },
      include: { subject: { select: { id: true, name: true } } },
    });
    if (!wb) throw new NotFoundException('作业本不存在');
    const [sections, grouped] = await Promise.all([
      this.loadSections(this.prisma, id),
      this.prisma.question.groupBy({
        by: ['workbookSectionId'],
        where: { workbookId: id },
        _count: true,
      }),
    ]);
    const counts = new Map<string | null, number>(
      (grouped as any[]).map((g) => [g.workbookSectionId, g._count]),
    );
    return {
      ...wb,
      tree: this.buildTree(sections, counts),
      // 作业本根（未分章节）的题目数，前端不必再用路径长度去猜
      rootQuestionCount: counts.get(null) ?? 0,
      questionCount: Array.from(counts.values()).reduce((a, b) => a + b, 0),
    };
  }

  async update(id: string, dto: { name?: string; subjectId?: string | null; description?: string }) {
    await this.assertWorkbook(this.prisma, id);
    const data: Prisma.WorkbookUpdateInput = {};
    let renamed = false;
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('作业本名称不能为空');
      data.name = name;
      renamed = true;
    }
    if (dto.subjectId !== undefined) {
      if (dto.subjectId) await this.assertSubject(this.prisma, dto.subjectId);
      data.subject = dto.subjectId ? { connect: { id: dto.subjectId } } : { disconnect: true };
    }
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.workbook.update({ where: { id }, data });
      // 改名后旗下题目的展示路径首段必须跟着变，否则前端显示的仍是旧作业本名
      if (renamed) await this.resyncSourcePaths(tx as unknown as Db, id);
      return updated;
    });
  }

  async remove(id: string) {
    await this.assertWorkbook(this.prisma, id);
    return this.prisma.$transaction(async (tx) => {
      const db = tx as unknown as Db;
      const sections = await this.loadSections(db, id);
      // 题目回到题库：显式清空归属与残留展示路径（不能只靠 FK 的 SET NULL，否则 sourcePath 变脏数据）
      const released = await this.releaseQuestions(db, { workbookId: id });
      // 审阅台里指向本作业本章节的录入任务同步解绑（IngestJob.workbookSectionId 无外键约束，会悬垂）
      if (sections.length) {
        await tx.ingestJob.updateMany({
          where: { workbookSectionId: { in: sections.map((s) => s.id) } },
          data: { workbookSectionId: null },
        });
      }
      await tx.workbook.delete({ where: { id } });
      return { ok: true, released };
    });
  }

  // =============================================================
  // 章节树
  // =============================================================

  async createSection(workbookId: string, dto: { name: string; parentId?: string | null }) {
    await this.assertWorkbook(this.prisma, workbookId);
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('章节名称不能为空');
    const parentId = dto.parentId || null;
    if (parentId) await this.assertSection(this.prisma, workbookId, parentId);
    await this.assertNoSiblingName(this.prisma, workbookId, parentId, name);
    const max = await this.prisma.workbookSection.aggregate({
      where: { workbookId, parentId },
      _max: { order: true },
    });
    return this.prisma.workbookSection.create({
      data: { workbookId, parentId, name, order: (max._max.order ?? -1) + 1 },
    });
  }

  async updateSection(
    workbookId: string,
    sectionId: string,
    dto: { name?: string; parentId?: string | null },
  ) {
    const section = await this.assertSection(this.prisma, workbookId, sectionId);
    const sections = await this.loadSections(this.prisma, workbookId);

    const nextName = dto.name !== undefined ? dto.name.trim() : section.name;
    if (dto.name !== undefined && !nextName) throw new BadRequestException('章节名称不能为空');

    let nextParentId = section.parentId;
    const moving = dto.parentId !== undefined && (dto.parentId || null) !== section.parentId;
    if (moving) {
      nextParentId = dto.parentId || null;
      if (nextParentId) {
        if (nextParentId === sectionId) throw new BadRequestException('不能把章节移动到自身下');
        const descendants = this.subtreeIds(sections, sectionId);
        if (descendants.includes(nextParentId)) throw new BadRequestException('不能把章节移动到它自己的子章节下');
        await this.assertSection(this.prisma, workbookId, nextParentId);
      }
    }

    if (dto.name !== undefined || moving) {
      await this.assertNoSiblingName(this.prisma, workbookId, nextParentId, nextName, sectionId);
    }

    const data: Prisma.WorkbookSectionUpdateInput = {};
    if (dto.name !== undefined) data.name = nextName;
    if (moving) {
      data.parent = nextParentId ? { connect: { id: nextParentId } } : { disconnect: true };
      // 换了父节点就得重新排到新同级末尾，否则 order 与新兄弟冲突、顺序随机
      const max = await this.prisma.workbookSection.aggregate({
        where: { workbookId, parentId: nextParentId },
        _max: { order: true },
      });
      data.order = (max._max.order ?? -1) + 1;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.workbookSection.update({ where: { id: sectionId }, data });
      // 改名 / 移动都会改变展示路径，题目归属（外键）不变但 sourcePath 必须重算
      if (dto.name !== undefined || moving) await this.resyncSourcePaths(tx as unknown as Db, workbookId);
      return updated;
    });
  }

  /** 同级内上移 / 下移一位；顺序会被规范化为连续的 0..n-1 */
  async moveSection(workbookId: string, sectionId: string, direction: 'up' | 'down') {
    const section = await this.assertSection(this.prisma, workbookId, sectionId);
    const siblings = await this.prisma.workbookSection.findMany({
      where: { workbookId, parentId: section.parentId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    const idx = siblings.findIndex((s) => s.id === sectionId);
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || target < 0 || target >= siblings.length) {
      throw new BadRequestException(direction === 'up' ? '已经是同级第一个了' : '已经是同级最后一个了');
    }
    const ordered = [...siblings];
    [ordered[idx], ordered[target]] = [ordered[target], ordered[idx]];
    await this.prisma.$transaction(
      ordered.map((s, i) => this.prisma.workbookSection.update({ where: { id: s.id }, data: { order: i } })),
    );
    return { ok: true };
  }

  /**
   * 删除章节及其全部子章节。
   * 其下题目从作业本移出、回到题库（题目本身不删），避免深层题目被跨层级塞到作业本根。
   */
  async removeSection(workbookId: string, sectionId: string) {
    await this.assertSection(this.prisma, workbookId, sectionId);
    const sections = await this.loadSections(this.prisma, workbookId);
    const subtree = this.subtreeIds(sections, sectionId);

    return this.prisma.$transaction(async (tx) => {
      const db = tx as unknown as Db;
      const released = await this.releaseQuestions(db, {
        workbookId,
        workbookSectionId: { in: subtree },
      });
      // 审阅台可能正指向被删章节，一并解绑，避免悬垂 id
      await tx.ingestJob.updateMany({
        where: { workbookSectionId: { in: subtree } },
        data: { workbookSectionId: null },
      });
      await tx.workbookSection.deleteMany({ where: { id: { in: subtree } } });
      return { ok: true, released, removedSections: subtree.length };
    });
  }

  /** 删除章节前的影响面预览，供前端把「会移出多少题」写进确认框 */
  async previewRemoveSection(workbookId: string, sectionId: string) {
    await this.assertSection(this.prisma, workbookId, sectionId);
    const sections = await this.loadSections(this.prisma, workbookId);
    const subtree = this.subtreeIds(sections, sectionId);
    const questionCount = await this.prisma.question.count({
      where: { workbookId, workbookSectionId: { in: subtree } },
    });
    return { sectionCount: subtree.length, questionCount };
  }

  // =============================================================
  // 题目归属
  // =============================================================

  async listQuestions(workbookId: string) {
    await this.assertWorkbook(this.prisma, workbookId);
    const sections = await this.loadSections(this.prisma, workbookId);
    // 章节树的展示序（前序遍历），题目按此序分组才与左侧树一致
    const orderIndex = new Map<string | null, number>([[null, 0]]);
    let seq = 1;
    const walk = (parentId: string | null) => {
      for (const s of sections.filter((x) => x.parentId === parentId)) {
        orderIndex.set(s.id, seq++);
        walk(s.id);
      }
    };
    walk(null);

    const questions = await this.prisma.question.findMany({
      where: { workbookId },
      orderBy: [{ number: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        type: true,
        stem: true,
        subjectId: true,
        sourcePath: true,
        workbookSectionId: true,
        number: true,
        difficulty: true,
        status: true,
        subject: { select: { id: true, name: true } },
      },
    });
    return questions.sort(
      (a, b) =>
        (orderIndex.get(a.workbookSectionId) ?? 0) - (orderIndex.get(b.workbookSectionId) ?? 0) ||
        (a.number ?? 0) - (b.number ?? 0),
    );
  }

  /**
   * 批量把题目归入作业本的某个章节（sectionId 为空 = 作业本根）。
   * 同一接口也用于作业本内换章节、以及从别的作业本移过来（题目单归属）。
   */
  async assignQuestions(workbookId: string, questionIds: string[], sectionId: string | null | undefined) {
    const wb = await this.assertWorkbook(this.prisma, workbookId);
    const targetSectionId = sectionId || null;
    let path: string[] = [wb.name];
    if (targetSectionId) {
      await this.assertSection(this.prisma, workbookId, targetSectionId);
      const sections = await this.loadSections(this.prisma, workbookId);
      const map = new Map(sections.map((s) => [s.id, s]));
      path = [wb.name, ...this.pathOf(map, targetSectionId)];
    }

    const unique = Array.from(new Set((questionIds || []).filter(Boolean)));
    if (!unique.length) throw new BadRequestException('请选择要添加的题目');

    return this.prisma.$transaction(async (tx) => {
      // 先校验再写：避免逐题 update 时中途报错造成「一半成功一半失败」
      const found = await tx.question.findMany({
        where: { id: { in: unique } },
        select: { id: true, workbookId: true, workbookSectionId: true },
      });
      if (found.length !== unique.length) {
        throw new BadRequestException(`有 ${unique.length - found.length} 道题目不存在或已被删除，请刷新后重试`);
      }
      const movedFromOther = found.filter((q) => q.workbookId && q.workbookId !== workbookId).length;
      const movedWithin = found.filter(
        (q) => q.workbookId === workbookId && q.workbookSectionId !== targetSectionId,
      ).length;
      const unchanged = found.filter(
        (q) => q.workbookId === workbookId && q.workbookSectionId === targetSectionId,
      ).length;

      await tx.question.updateMany({
        where: { id: { in: unique } },
        data: { workbookId, workbookSectionId: targetSectionId, sourcePath: path },
      });
      return {
        assigned: unique.length,
        movedFromOther,
        movedWithin,
        unchanged,
      };
    });
  }

  /** 把题目移出作业本（回到题库，题目本身不删） */
  async unassignQuestions(workbookId: string, questionIds: string[]) {
    await this.assertWorkbook(this.prisma, workbookId);
    const unique = Array.from(new Set((questionIds || []).filter(Boolean)));
    if (!unique.length) throw new BadRequestException('请选择要移出的题目');
    // 限定 workbookId：只解绑确实属于本作业本的题，避免误清其它作业本的归属
    const released = await this.releaseQuestions(this.prisma, { id: { in: unique }, workbookId });
    if (!released) throw new BadRequestException('所选题目已不在该作业本中，请刷新后重试');
    return { unassigned: released };
  }
}
