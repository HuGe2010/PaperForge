import client from './client';
import type {
  QuestionQuery,
  QuestionListItem,
  QuestionDetail,
  QuestionType,
  SourceType,
  QuestionStatus,
  QuestionContent,
} from '../types/models';

export interface CreateQuestionPayload {
  type: QuestionType;
  stem: string;
  content: QuestionContent;
  analysis?: string;
  difficulty?: number;
  subjectId?: string;
  knowledgePointIds?: string[];
  tagIds?: string[];
  sourceType?: SourceType;
  status?: QuestionStatus;
}

export interface QuestionListResult {
  items: QuestionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DedupQuestion {
  id: string;
  type: QuestionType;
  subjectId: string | null;
  stem: string;
  sourcePapers: string[];
  sourceImagePath: string | null;
}

export interface DedupGroup {
  id: string;
  questions: DedupQuestion[];
  similarity: number;
  /** 语义相似度（embedding 余弦），未计算时为 null */
  semanticSimilarity: number | null;
}

export interface DedupIgnoredGroup {
  ignoreId: string;
  kind: string;
  questions: DedupQuestion[];
}

/** 详情页「合并来的题目」：被并入题的识别内容 + AI 解答（实时取数，撤销合并后消失） */
export interface MergedQuestion {
  id: string;
  type: QuestionType;
  stem: string;
  content: QuestionContent | null;
  analysis: string | null;
  solution: string | null;
  status: string;
  sourcePaperName: string | null;
  sourcePapers: string[];
  sourceImagePath: string | null;
}

export const questionsApi = {
  list: (params: QuestionQuery): Promise<QuestionListResult> =>
    client.get<QuestionListResult>('/questions', { params }) as unknown as Promise<QuestionListResult>,
  get: (id: string) => client.get<QuestionDetail>(`/questions/${id}`),
  // 来源整页原图（blob），供详情页裁切展示
  sourceImageUrl: async (id: string): Promise<string> => {
    const blob = (await client.get(`/questions/${id}/source-image`, {
      responseType: 'blob',
    })) as unknown as Blob;
    return URL.createObjectURL(blob);
  },
  // 题内图片（content.images[].cropId → PNG；需带 /api 前缀，<img> 不走 axios baseURL）
  figureUrl: (cropId: string): string => `/api/questions/figure/${encodeURIComponent(cropId)}`,
  // 题图：本地上传（「+图片」→ 上传文件）
  figureUpload: (fd: FormData): Promise<{ cropId: string }> =>
    client.post<{ cropId: string }>('/questions/figure-upload', fd) as unknown as Promise<{ cropId: string }>,
  // 题图：从试卷页框选裁切（「+图片」→ 从 PDF/图片页选择）
  figureFromPage: (data: { pageId: string; bbox: number[] }): Promise<{ cropId: string }> =>
    client.post<{ cropId: string }>('/questions/figure-from-page', data) as unknown as Promise<{ cropId: string }>,
  create: (data: CreateQuestionPayload) => client.post<QuestionDetail>('/questions', data),
  update: (id: string, data: Partial<CreateQuestionPayload>) =>
    client.put<QuestionDetail>(`/questions/${id}`, data),
  remove: (id: string) => client.delete(`/questions/${id}`),
  // 批量删除题目：返回 { deleted, protected }，protected 为因已被考试作答引用而跳过的题目 id
  batchRemove: (ids: string[]): Promise<{ deleted: number; protected: string[] }> =>
    client.post<{ deleted: number; protected: string[] }>('/questions/batch-delete', { ids }) as unknown as Promise<{
      deleted: number;
      protected: string[];
    }>,
  // 题内图片原子更新（采用已框题图 / 上传 / 从页面裁），服务端校验并去重
  setImages: (id: string, images: Array<{ cropId: string; label?: string }>) =>
    client.patch(`/questions/${id}/images`, { images }),
  // 试卷侧边栏「添加题目到试卷」：把题库已有题目追加归属到指定试卷（写 sourcePapers，去重）
  addToPaper: (paperName: string, questionIds: string[]) =>
    client.post<{ added: number }>('/questions/add-to-paper', { paperName, questionIds }) as unknown as Promise<{
      added: number;
    }>,
  // 试卷侧边栏「从小卷移除题目」：剔除 sourcePapers 中的试卷名（不删除题目）
  removeFromPaper(paperName: string, ids: string[]) {
    return client.post('/questions/remove-from-paper', { paperName, questionIds: ids });
  },
  // 入库后统一触发 AI 解答（解析 + 步骤），可能耗时较长，单独放宽超时
  solve: (id: string) =>
    client.post<{ analysis: string; solution: string; model: string }>(`/questions/${id}/solve`, undefined, {
      timeout: 180000,
    }) as unknown as Promise<{
      analysis: string;
      solution: string;
      model: string;
    }>,
  // ---------------- 题目查重（人工） ----------------
  dedupGroups: () => client.get<DedupGroup[]>('/questions/dedup/groups') as unknown as Promise<DedupGroup[]>,
  dedupIgnored: () =>
    client.get<DedupIgnoredGroup[]>('/questions/dedup/ignored') as unknown as Promise<DedupIgnoredGroup[]>,
  dedupCount: () => client.get<{ groups: number }>('/questions/dedup/count') as unknown as Promise<{ groups: number }>,
  // 回填存量题目语义向量：返回 {total, generated}
  backfill: () =>
    client.post<{ total: number; generated: number }>('/questions/dedup/backfill') as unknown as Promise<{
      total: number;
      generated: number;
    }>,
  ignoreGroup: (questionIds: string[]) =>
    client.post<{ ignoreId: string }>('/questions/dedup/ignore', { questionIds }) as unknown as Promise<{
      ignoreId: string;
    }>,
  ignorePair: (a: string, b: string) =>
    client.post<{ ignoreId: string }>('/questions/dedup/ignore-pair', { a, b }) as unknown as Promise<{
      ignoreId: string;
    }>,
  unignore: (ignoreId: string) => client.delete(`/questions/dedup/ignore/${ignoreId}`),
  merge: (keptId: string, absorbedIds: string[]) =>
    client.post<{ keptId: string; archived: string[]; mergeId: string }>('/questions/dedup/merge', {
      keptId,
      absorbedIds,
    }) as unknown as Promise<{ keptId: string; archived: string[]; mergeId: string }>,
  undoMerge: (mergeId: string) => client.post(`/questions/dedup/merge/${mergeId}/undo`),
  undoMergeByQuestion: (questionId: string) =>
    client.post<{ undone: boolean; keptId?: string }>(`/questions/dedup/merge-by-question/${questionId}/undo`) as unknown as Promise<{
      undone: boolean;
      keptId?: string;
    }>,
  // 详情页：保留题名下「合并来的题目」（识别内容 + AI 解答，实时取数）
  mergedQuestions: (keptId: string) =>
    client.get<MergedQuestion[]>(`/questions/dedup/merged-questions/${keptId}`) as unknown as Promise<MergedQuestion[]>,
  // 归档页：恢复（取消归档）
  restore: (id: string) => client.post<QuestionDetail>(`/questions/${id}/restore`) as unknown as Promise<QuestionDetail>,
};
