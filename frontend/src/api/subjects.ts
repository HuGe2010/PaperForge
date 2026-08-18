import client from './client';
import type { Subject } from '../types/models';

export interface CreateSubjectPayload {
  name: string;
  code?: string;
  parentId?: string;
  description?: string;
  order?: number;
}

export const subjectsApi = {
  tree: () => client.get<Subject[]>('/subjects'),
  create: (data: CreateSubjectPayload) => client.post<Subject>('/subjects', data),
  update: (id: string, data: Partial<CreateSubjectPayload>) =>
    client.put<Subject>(`/subjects/${id}`, data),
  remove: (id: string) => client.delete(`/subjects/${id}`),
};
