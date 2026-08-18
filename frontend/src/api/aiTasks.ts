import client from './client';
import type { AiTaskLog } from '../types/models';

/** 仪表盘「AI 工作进度」数据源：进行中的任务置顶 + 最近 N 条 */
export const aiTasksApi = {
  list: (params: { limit?: number; status?: string; page?: number } = {}): Promise<{
    items: AiTaskLog[];
    total: number;
    page: number;
    pageSize: number;
    running: number;
  }> => client.get<{ items: AiTaskLog[]; total: number; page: number; pageSize: number; running: number }>('/ai-tasks', { params }) as unknown as Promise<{
    items: AiTaskLog[];
    total: number;
    page: number;
    pageSize: number;
    running: number;
  }>,
};
