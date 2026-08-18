import client from './client';
import type { Tag } from '../types/models';

export interface CreateTagPayload {
  name: string;
  group?: string;
}

export const tagsApi = {
  list: (group?: string) => client.get<Tag[]>('/tags', { params: group ? { group } : undefined }),
  create: (data: CreateTagPayload) => client.post<Tag>('/tags', data),
  update: (id: string, data: Partial<CreateTagPayload>) =>
    client.put<Tag>(`/tags/${id}`, data),
  remove: (id: string) => client.delete(`/tags/${id}`),
};
