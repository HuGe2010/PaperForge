import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.permission.findMany({ orderBy: [{ group: 'asc' }, { code: 'asc' }] });
  }

  async findByGroup() {
    const all = await this.findAll();
    return all.reduce<Record<string, any[]>>((acc, p) => {
      const g = p.group ?? '其他';
      (acc[g] ??= []).push(p);
      return acc;
    }, {});
  }
}
