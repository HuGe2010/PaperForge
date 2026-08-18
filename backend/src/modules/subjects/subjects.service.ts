import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';

export interface SubjectNode {
  id: string;
  name: string;
  code: string | null;
  parentId: string | null;
  description: string | null;
  order: number;
  children: SubjectNode[];
}

@Injectable()
export class SubjectsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 返回学科树（按 order 排序） */
  async findTree(): Promise<SubjectNode[]> {
    const all = await this.prisma.subject.findMany({ orderBy: { order: 'asc' } });
    const map = new Map<string, SubjectNode>();
    all.forEach((s) =>
      map.set(s.id, {
        id: s.id,
        name: s.name,
        code: s.code,
        parentId: s.parentId,
        description: s.description,
        order: s.order,
        children: [],
      }),
    );
    const roots: SubjectNode[] = [];
    map.forEach((node) => {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }

  async create(dto: CreateSubjectDto) {
    if (dto.parentId) {
      const parent = await this.prisma.subject.findUnique({ where: { id: dto.parentId } });
      if (!parent) throw new NotFoundException('父学科不存在');
    }
    return this.prisma.subject.create({ data: dto });
  }

  async update(id: string, dto: UpdateSubjectDto) {
    await this.ensureExists(id);
    if (dto.parentId === id) throw new BadRequestException('不能将学科设为自身的父级');
    if (dto.parentId) {
      const parent = await this.prisma.subject.findUnique({ where: { id: dto.parentId } });
      if (!parent) throw new NotFoundException('父学科不存在');
    }
    return this.prisma.subject.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    const childCount = await this.prisma.subject.count({ where: { parentId: id } });
    const qCount = await this.prisma.question.count({ where: { subjectId: id } });
    if (childCount > 0 || qCount > 0) {
      throw new BadRequestException('该学科下仍存在子学科或试题，无法删除');
    }
    return this.prisma.subject.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.subject.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('学科不存在');
  }
}
