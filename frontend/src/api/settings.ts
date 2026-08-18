import client from './client';

export interface SettingItemView {
  key: string;
  isSecret: boolean;
  hasValue: boolean;
  value?: string | null;
  updatedAt?: string;
}

export interface SettingItemInput {
  key: string;
  value: string | null;
  isSecret?: boolean;
}

export const settingsApi = {
  getGroup: (group: string) =>
    client.get<SettingItemView[]>(`/settings/${group}`) as unknown as Promise<SettingItemView[]>,
  setGroup: (group: string, items: SettingItemInput[]) =>
    client.put(`/settings/${group}`, { items }) as unknown as Promise<SettingItemView[]>,
};
