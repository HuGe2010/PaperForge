import { defineStore } from 'pinia';
import { authApi } from '../api/auth';
import type { UserProfile } from '../types/models';
import router from '../router';

interface AuthState {
  user: UserProfile | null;
  accessToken: string;
  refreshToken: string;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    accessToken: localStorage.getItem('accessToken') || '',
    refreshToken: localStorage.getItem('refreshToken') || '',
  }),
  getters: {
    isLoggedIn: (s) => !!s.accessToken,
    roles: (s) => s.user?.roles ?? [],
    permissions: (s) => s.user?.permissions ?? [],
    displayName: (s) => s.user?.name || s.user?.username || '',
  },
  actions: {
    async login(username: string, password: string) {
      const res = await authApi.login({ username, password });
      this.accessToken = res.accessToken;
      this.refreshToken = res.refreshToken;
      this.user = res.user;
      localStorage.setItem('accessToken', res.accessToken);
      localStorage.setItem('refreshToken', res.refreshToken);
      return res;
    },
    async fetchMe() {
      const res = await authApi.me();
      const profile = res as unknown as { sub?: string } & UserProfile;
      this.user = { ...profile, id: profile.id || profile.sub || '' };
      return this.user as UserProfile;
    },
    async logout() {
      if (this.refreshToken) {
        try {
          await authApi.logout(this.refreshToken);
        } catch {
          /* ignore */
        }
      }
      this.user = null;
      this.accessToken = '';
      this.refreshToken = '';
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      router.push({ name: 'login' });
    },
    hasPermission(code: string) {
      return this.permissions.includes(code);
    },
    hasRole(code: string) {
      return this.roles.includes(code);
    },
  },
});
