import client from './client';
import type {
  Paper,
  PaperListResult,
  ComposeCandidate,
  QuestionType,
  PaperStatus,
} from '../types/models';

export interface CreatePaperPayload {
  title: string;
  description?: string;
  subjectId?: string;
  estimatedMinutes?: number;
  status?: PaperStatus;
}

export interface UpdatePaperPayload {
  title?: string;
  description?: string;
  subjectId?: string;
  estimatedMinutes?: number;
  status?: PaperStatus;
}

export interface ComposeParams {
  subjectId?: string;
  types?: QuestionType[];
  difficultyMin?: number;
  difficultyMax?: number;
  count?: number;
}

export interface AddQuestionPayload {
  questionId: string;
  score?: number;
}

export interface BatchAddPayload {
  items: AddQuestionPayload[];
}

export const papersApi = {
  create: (data: CreatePaperPayload): Promise<Paper> =>
    client.post<Paper>('/papers', data) as unknown as Promise<Paper>,

  update: (id: string, data: UpdatePaperPayload): Promise<Paper> =>
    client.put<Paper>(`/papers/${id}`, data) as unknown as Promise<Paper>,

  remove: (id: string): Promise<void> => client.delete(`/papers/${id}`),

  list: (params: { status?: string; page?: number; pageSize?: number }): Promise<PaperListResult> =>
    client.get<PaperListResult>('/papers', { params }) as unknown as Promise<PaperListResult>,

  get: (id: string): Promise<Paper> =>
    client.get<Paper>(`/papers/${id}`) as unknown as Promise<Paper>,

  compose: (params: ComposeParams): Promise<ComposeCandidate[]> =>
    client.get<ComposeCandidate[]>('/papers/compose', { params }) as unknown as Promise<ComposeCandidate[]>,

  addQuestion: (paperId: string, data: AddQuestionPayload): Promise<any> =>
    client.post(`/papers/${paperId}/questions`, data),

  batchAdd: (paperId: string, data: BatchAddPayload): Promise<Paper> =>
    client.post<Paper>(`/papers/${paperId}/questions/batch`, data) as unknown as Promise<Paper>,

  removeQuestion: (paperId: string, pqId: string): Promise<void> =>
    client.delete(`/papers/${paperId}/questions/${pqId}`),

  reorder: (paperId: string, orderedIds: string[]): Promise<void> =>
    client.post(`/papers/${paperId}/questions/reorder`, { orderedIds }),

  setScore: (paperId: string, pqId: string, score: number): Promise<void> =>
    client.patch(`/papers/${paperId}/questions/${pqId}`, { score }),
};
