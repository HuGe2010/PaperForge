import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateKnowledgePointDto } from './dto/create-knowledge.dto';
import { UpdateKnowledgePointDto } from './dto/create-knowledge.dto';

export interface KpNode {
  id: string;
  subjectId: string;
  name: string;
  parentId: string | null;
  path: string;
  level: number;
  order: number;
  questionCount: number;
  children: KpNode[];
}

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  async findTree(subjectId: string): Promise<KpNode[]> {
    const all = await this.prisma.knowledgePoint.findMany({
      where: { subjectId },
      orderBy: { order: 'asc' },
      include: { _count: { select: { questions: true } } },
    });
    const map = new Map<string, KpNode>();
    all.forEach((k) =>
      map.set(k.id, {
        id: k.id,
        subjectId: k.subjectId,
        name: k.name,
        parentId: k.parentId,
        path: k.path,
        level: k.level,
        order: k.order,
        questionCount: k._count.questions,
        children: [],
      }),
    );
    const roots: KpNode[] = [];
    map.forEach((node) => {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }

  async create(dto: CreateKnowledgePointDto) {
    const subject = await this.prisma.subject.findUnique({ where: { id: dto.subjectId } });
    if (!subject) throw new NotFoundException('学科不存在');
    let parentPath = '';
    let level = 1;
    if (dto.parentId) {
      const parent = await this.prisma.knowledgePoint.findUnique({ where: { id: dto.parentId } });
      if (!parent) throw new NotFoundException('父知识点不存在');
      parentPath = parent.path;
      level = parent.level + 1;
    }
    // 先建节点拿到 id，再用 id 作为物化路径末段（保证唯一且可 LIKE 查询子树）
    const created = await this.prisma.knowledgePoint.create({
      data: {
        subjectId: dto.subjectId,
        name: dto.name,
        parentId: dto.parentId,
        order: dto.order ?? 0,
        level,
        path: '',
      },
    });
    const path = parentPath ? `${parentPath}.${created.id}` : created.id;
    return this.prisma.knowledgePoint.update({
      where: { id: created.id },
      data: { path, level: path.split('.').length },
    });
  }

  async update(id: string, dto: UpdateKnowledgePointDto) {
    await this.ensureExists(id);
    if (dto.parentId === id) throw new BadRequestException('不能将知识点设为自身的父级');
    if (dto.parentId) {
      const parent = await this.prisma.knowledgePoint.findUnique({ where: { id: dto.parentId } });
      if (!parent) throw new NotFoundException('父知识点不存在');
    }
    return this.prisma.knowledgePoint.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    const childCount = await this.prisma.knowledgePoint.count({ where: { parentId: id } });
    const qCount = await this.prisma.question.count({ where: { knowledgePoints: { some: { id } } } });
    if (childCount > 0 || qCount > 0) {
      throw new BadRequestException('该知识点下仍存在子节点或试题，无法删除');
    }
    return this.prisma.knowledgePoint.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.knowledgePoint.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('知识点不存在');
  }
}
