import client from './client';
import type { UserProfile } from '../types/models';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: UserProfile;
}

export const authApi = {
  login: (data: { username: string; password: string }) =>
    client.post('/auth/login', data) as unknown as Promise<LoginResult>,
  refresh: (refreshToken: string) =>
    client.post('/auth/refresh', { refreshToken }) as unknown as Promise<LoginResult>,
  me: () => client.get('/auth/me') as unknown as Promise<UserProfile>,
  logout: (refreshToken: string) => client.post('/auth/logout', { refreshToken }),
};
