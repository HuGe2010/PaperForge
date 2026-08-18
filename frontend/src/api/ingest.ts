import client from './client';
import type {
  IngestJob,
  IngestListResult,
  OcrItem,
  KnowledgePointSuggestion,
} from '../types/models';

export interface IngestListParams {
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface ReviewItemPayload {
  type?: string;
  stem?: string;
  content?: Record<string, any>;
  analysis?: string;
  difficulty?: number;
  bbox?: number[];
  paperName?: string;
  subjectId?: string;
  status?: string;
  /** 题内图片区域（OCR 识别题图，人工可改） */
  figures?: Array<{ bbox: number[]; cropId?: string; label?: string }>;
  /** 大题分组/题号（右侧题号面板拖拽即保存） */
  groupIndex?: number | null;
  groupTitle?: string | null;
  number?: number | null;
}

export interface ApproveItemPayload {
  subjectId?: string;
  tagIds?: string[];
  knowledgePointIds?: string[];
  paperName?: string;
}

/** 自动框选接口的返回：完整任务 + AI 原始回复（用于调试展示） */
export interface DetectResponse {
  job: IngestJob;
  rawReply: string;
}

export const ingestApi = {
  upload: (file: File, subjectId?: string, displayName?: string): Promise<IngestJob> => {
    const form = new FormData();
    form.append('file', file);
    const qs: string[] = [];
    if (subjectId) qs.push(`subjectId=${encodeURIComponent(subjectId)}`);
    if (displayName) qs.push(`displayName=${encodeURIComponent(displayName)}`);
    const url = '/ingest/upload' + (qs.length ? `?${qs.join('&')}` : '');
    return client.post<IngestJob>(url, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // PDF 上传含逐页转图，放宽到 3 分钟
      timeout: 180000,
    }) as unknown as Promise<IngestJob>;
  },

  // 步骤 2：自动框选（本地 OCR 两阶段）。首次含 PaddleOCR 模型加载、多页 PDF 逐页处理，
  // 单页 60~110s，必须单独放宽超时（全局默认仅 60s 会误判超时）。
  detect: (jobId: string, subjectId?: string): Promise<DetectResponse> =>
    client.post<DetectResponse>(
      `/ingest/${jobId}/detect` + (subjectId ? `?subjectId=${subjectId}` : ''),
      undefined,
      { timeout: 600000 },
    ) as unknown as Promise<DetectResponse>,

  // 调试：获取当前实际发给 AI 的版面检测提示词
  getDetectPrompt: (): Promise<{ prompt: string }> =>
    client.get<{ prompt: string }>('/ingest/detect-prompt') as unknown as Promise<{ prompt: string }>,

  // 步骤 4：AI 识别题目内容（逐题裁切后识别，题目多时耗时较长，单独放宽超时）。
  // 题型由用户指定，识别只回填内容；未指定题型的题会跳过，返回 skippedIndexes。
  recognize: (jobId: string, subjectId?: string): Promise<{ job: IngestJob; skippedIndexes: number[] }> =>
    client.post<{ job: IngestJob; skippedIndexes: number[] }>(
      `/ingest/${jobId}/recognize` + (subjectId ? `?subjectId=${subjectId}` : ''),
      undefined,
      { timeout: 600000 },
    ) as unknown as Promise<{ job: IngestJob; skippedIndexes: number[] }>,

  // 步骤 3 辅助：人工新增题目框
  addBox: (pageId: string, bbox: number[], type?: string): Promise<OcrItem> =>
    client.post<OcrItem>('/ingest/items', { pageId, bbox, type }) as unknown as Promise<OcrItem>,

  // 页面级图片框：手绘一个图片区域（与题目框解耦）
  addPageFigure: (pageId: string, bbox: number[], label?: string): Promise<{ bbox: number[]; cropId?: string; label?: string }> =>
    client.post('/ingest/pages/' + pageId + '/figures', { bbox, label }) as unknown as Promise<{ bbox: number[]; cropId?: string; label?: string }>,

  // 页面级图片框：移动/缩放/删除后整体替换
  updatePageFigures: (pageId: string, figures: Array<{ bbox: number[]; cropId?: string; label?: string }>): Promise<Array<{ bbox: number[]; cropId?: string; label?: string }>> =>
    client.patch('/ingest/pages/' + pageId + '/figures', { figures }) as unknown as Promise<Array<{ bbox: number[]; cropId?: string; label?: string }>>,

  // 页面原图（框选编辑器展示）。返回 Blob 由调用方转 ObjectURL。
  pageImageUrl: async (pageId: string): Promise<string> => {
    const blob = (await client.get(`/ingest/pages/${pageId}/image`, {
      responseType: 'blob',
    })) as unknown as Blob;
    return URL.createObjectURL(blob);
  },

  list: (params: IngestListParams): Promise<IngestListResult> =>
    client.get<IngestListResult>('/ingest', { params }) as unknown as Promise<IngestListResult>,

  // 文件列表（试卷/作业本），供题库「按试卷/作业本」浏览
  listFiles: (sourceType?: 'PAPER' | 'WORKBOOK'): Promise<{ id: string; name: string; subjectId: string | null; count: number; pageId: string | null }[]> =>
    client.get('/ingest/files' + (sourceType ? `?sourceType=${sourceType}` : '')) as unknown as Promise<any[]>,

  get: (id: string): Promise<IngestJob> =>
    client.get<IngestJob>(`/ingest/${id}`) as unknown as Promise<IngestJob>,

  remove: (jobId: string): Promise<{ ok: boolean }> =>
    client.delete<{ ok: boolean }>(`/ingest/${jobId}`) as unknown as Promise<{ ok: boolean }>,

  review: (itemId: string, data: ReviewItemPayload): Promise<OcrItem> =>
    client.patch<OcrItem>(`/ingest/items/${itemId}`, data) as unknown as Promise<OcrItem>,

  approve: (itemId: string, data: ApproveItemPayload): Promise<any> =>
    client.post(`/ingest/items/${itemId}/approve`, data),

  reject: (itemId: string): Promise<{ ok: boolean }> =>
    client.post(`/ingest/items/${itemId}/reject`) as unknown as Promise<{ ok: boolean }>,

  // 审阅台统一操作区：批量设置文件类型/名称/学科；作业本模式指向已有作业本实体 + 具体章节
  updateMeta: (
    jobId: string,
    data: {
      sourceType?: 'PAPER' | 'WORKBOOK';
      name?: string;
      subjectId?: string;
      workbookId?: string;
      workbookSectionId?: string | null;
    },
  ): Promise<IngestJob> => client.patch<IngestJob>(`/ingest/${jobId}/meta`, data) as unknown as Promise<IngestJob>,

  // 题库「编辑试卷」：改名（同步题目来源）+ 题目排序/大题修改
  editPaper: (jobId: string, data: { name?: string; items?: { id: string; number?: number | null; groupIndex?: number | null; groupTitle?: string | null }[] }): Promise<IngestJob> =>
    client.patch<IngestJob>(`/ingest/${jobId}/paper-edit`, data) as unknown as Promise<IngestJob>,

  // 单题重新识别（审阅台逐题重跑 VLM）。单题耗时短，超时放宽到 120s。
  recognizeItem: (itemId: string, subjectId?: string): Promise<OcrItem> =>
    client.post<OcrItem>(
      `/ingest/items/${itemId}/recognize` + (subjectId ? `?subjectId=${subjectId}` : ''),
      undefined,
      { timeout: 120000 },
    ) as unknown as Promise<OcrItem>,

  // 审阅台合并跨页截断题：上传前后页拼接图 + 两个 item id（keepId 保留、mergedId 并入后删除）
  mergeItems: (keepId: string, mergedId: string, file: Blob): Promise<IngestJob> => {
    const form = new FormData();
    form.append('file', file, 'merged.png');
    form.append('keepId', keepId);
    form.append('mergedId', mergedId);
    return client.post<IngestJob>('/ingest/items/merge', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    }) as unknown as Promise<IngestJob>;
  },

  // 回退合并：把合并后的题目拆回合并前的两道题
  unmergeItem: (itemId: string): Promise<IngestJob> =>
    client.post<IngestJob>(`/ingest/items/${itemId}/unmerge`) as unknown as Promise<IngestJob>,

  // AI 框选进度（进度条轮询）
  detectProgress: (jobId: string): Promise<{ done: number; total: number; pageIndex: number }> =>
    client.get(`/ingest/${jobId}/detect-progress`) as unknown as Promise<{
      done: number;
      total: number;
      pageIndex: number;
    }>,

  suggestions: (subjectId?: string): Promise<KnowledgePointSuggestion[]> =>
    client.get<KnowledgePointSuggestion[]>(
      '/ingest/suggestions' + (subjectId ? `?subjectId=${subjectId}` : ''),
    ) as unknown as Promise<KnowledgePointSuggestion[]>,

  approveSuggestion: (id: string, parentId?: string): Promise<any> =>
    client.post(`/ingest/suggestions/${id}/approve` + (parentId ? `?parentId=${parentId}` : '')),

  rejectSuggestion: (id: string): Promise<{ ok: boolean }> =>
    client.post(`/ingest/suggestions/${id}/reject`) as unknown as Promise<{ ok: boolean }>,
};
