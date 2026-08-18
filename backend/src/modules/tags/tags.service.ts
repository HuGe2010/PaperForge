import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTagDto, UpdateTagDto } from './dto/create-tag.dto';

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(group?: string) {
    return this.prisma.tag.findMany({
      where: group ? { group } : undefined,
      orderBy: { name: 'asc' },
      include: { _count: { select: { questions: true } } },
    });
  }

  async create(dto: CreateTagDto) {
    return this.prisma.tag.create({ data: dto });
  }

  async update(id: string, dto: UpdateTagDto) {
    await this.ensureExists(id);
    return this.prisma.tag.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    return this.prisma.tag.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.tag.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('标签不存在');
  }
}
