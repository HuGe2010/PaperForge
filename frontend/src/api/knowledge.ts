import client from './client';
import type { KnowledgePoint } from '../types/models';

export interface CreateKnowledgePayload {
  subjectId: string;
  name: string;
  parentId?: string;
  order?: number;
}

export const knowledgeApi = {
  tree: (subjectId: string) =>
    client.get<KnowledgePoint[]>('/knowledge-points/tree', { params: { subjectId } }),
  create: (data: CreateKnowledgePayload) =>
    client.post<KnowledgePoint>('/knowledge-points', data),
  update: (id: string, data: Partial<CreateKnowledgePayload>) =>
    client.put<KnowledgePoint>(`/knowledge-points/${id}`, data),
  remove: (id: string) => client.delete(`/knowledge-points/${id}`),
};
