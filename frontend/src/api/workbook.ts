import client from './client';
import type { Workbook, WorkbookSectionNode } from '../types/models';

export interface CreateWorkbookPayload {
  name: string;
  subjectId?: string;
  description?: string;
}

export interface UpdateWorkbookPayload {
  name?: string;
  /** 传 null/空串表示清除学科 */
  subjectId?: string | null;
  description?: string;
}

export interface CreateSectionPayload {
  name: string;
  /** 传 null/空串表示建在作业本根下 */
  parentId?: string | null;
}

export interface UpdateSectionPayload {
  name?: string;
  /** 传 null/空串表示移到作业本根下 */
  parentId?: string | null;
  order?: number;
}

export type MoveSectionDirection = 'up' | 'down';

export interface MoveSectionPayload {
  direction: MoveSectionDirection;
}

export interface AssignQuestionPayload {
  questionIds: string[];
  /** 目标章节（null/空 = 放到作业本根，仅 [作业本名]）。任意层级章节均可，不限于叶子 */
  sectionId?: string | null;
}

export interface UnassignQuestionPayload {
  questionIds: string[];
}

/** 作业本内题目（GET /workbooks/:id/questions 返回） */
export interface WorkbookQuestion {
  id: string;
  type: string;
  stem: string;
  subjectId: string | null;
  sourcePath: string[] | null;
  /** 归属章节（null = 作业本根，即未分章节） */
  workbookSectionId: string | null;
  number: number | null;
  difficulty: number | null;
  status: string;
  subject?: { id: string; name: string } | null;
}

export const workbookApi = {
  create: (data: CreateWorkbookPayload): Promise<Workbook> =>
    client.post<Workbook>('/workbooks', data) as unknown as Promise<Workbook>,

  list: (): Promise<Workbook[]> => client.get<Workbook[]>('/workbooks') as unknown as Promise<Workbook[]>,

  get: (
    id: string,
  ): Promise<
    Workbook & {
      tree: WorkbookSectionNode[];
      rootQuestionCount: number;
      questionCount: number;
    }
  > =>
    client.get(`/workbooks/${id}`) as unknown as Promise<
      Workbook & {
        tree: WorkbookSectionNode[];
        rootQuestionCount: number;
        questionCount: number;
      }
    >,

  update: (id: string, data: UpdateWorkbookPayload): Promise<Workbook> =>
    client.patch<Workbook>(`/workbooks/${id}`, data) as unknown as Promise<Workbook>,

  remove: (id: string): Promise<{ ok: boolean }> => client.delete(`/workbooks/${id}`),

  listQuestions: (id: string): Promise<WorkbookQuestion[]> =>
    client.get(`/workbooks/${id}/questions`) as unknown as Promise<WorkbookQuestion[]>,

  createSection: (id: string, data: CreateSectionPayload) =>
    client.post(`/workbooks/${id}/sections`, data),

  updateSection: (id: string, sectionId: string, data: UpdateSectionPayload) =>
    client.patch(`/workbooks/${id}/sections/${sectionId}`, data),

  /** 同级章节上下移动（归一化排序） */
  moveSection: (id: string, sectionId: string, data: MoveSectionPayload) =>
    client.post(`/workbooks/${id}/sections/${sectionId}/move`, data),

  removeSection: (id: string, sectionId: string): Promise<{ ok: boolean; reset: number }> =>
    client.delete(`/workbooks/${id}/sections/${sectionId}`) as unknown as Promise<{ ok: boolean; reset: number }>,

  assign: (id: string, data: AssignQuestionPayload): Promise<{ assigned: number }> =>
    client.post(`/workbooks/${id}/assign`, data) as unknown as Promise<{ assigned: number }>,

  /** 把题目从作业本移出，回到题库（题目不删） */
  unassign: (id: string, data: UnassignQuestionPayload): Promise<{ unassigned: number }> =>
    client.post(`/workbooks/${id}/unassign`, data) as unknown as Promise<{ unassigned: number }>,
};
