import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AiTasksService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 仪表盘「AI 工作进度」数据源：
   * 返回进行中的任务（RUNNING，置顶）+ 最近 N 条（可翻页），按时间倒序。
   */
  async list(opts: { limit: number; status?: string; page?: number }) {
    const limit = opts.limit || 50;
    const page = opts.page || 1;
    const where: any = {};
    if (opts.status) where.status = opts.status;

    const [running, total, recent] = await Promise.all([
      // 进行中的任务：不受分页限制，始终置顶展示
      this.prisma.aiTaskLog.findMany({
        where: { status: 'RUNNING' },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      this.prisma.aiTaskLog.count({ where }),
      this.prisma.aiTaskLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // 进行中的去重后放最前
    const runningIds = new Set(running.map((r) => r.id));
    const items = [...running, ...recent.filter((r) => !runningIds.has(r.id))];
    return { items, total, page, pageSize: limit, running: running.length };
  }
}
