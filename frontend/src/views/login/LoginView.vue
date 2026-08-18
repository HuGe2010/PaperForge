<template>
  <AuthLayout>
    <div class="login">
      <!-- 主题切换 -->
      <button class="login__theme" type="button" :aria-label="isDark ? '切换为亮色' : '切换为暗色'" @click="toggleTheme()">
        <el-icon><component :is="isDark ? 'Sunny' : 'Moon'" /></el-icon>
      </button>

      <div class="login__card">
        <div class="login__brand">
          <div class="login__logo">
            <el-icon :size="26"><Notebook /></el-icon>
          </div>
          <h1 class="login__title">智能试卷与试题整理系统</h1>
          <p class="login__subtitle">题库管理 · 智能组卷 · 在线考试 · 自动评分</p>
        </div>

        <el-form :model="form" label-position="top" @submit.prevent="onSubmit">
          <el-form-item label="用户名">
            <el-input v-model="form.username" placeholder="请输入用户名" size="large" clearable>
              <template #prefix><el-icon><User /></el-icon></template>
            </el-input>
          </el-form-item>
          <el-form-item label="密码">
            <el-input
              v-model="form.password"
              type="password"
              show-password
              size="large"
              placeholder="请输入密码"
              @keyup.enter="onSubmit"
            >
              <template #prefix><el-icon><Lock /></el-icon></template>
            </el-input>
          </el-form-item>
          <el-button type="primary" size="large" class="login__submit" :loading="loading" @click="onSubmit">
            登录
          </el-button>
        </el-form>

        <p class="login__hint">默认管理员：<code>admin</code> / <code>Exam@2024!</code></p>
      </div>
    </div>
  </AuthLayout>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { useTheme } from '@/composables/useTheme';
import AuthLayout from '@/layouts/AuthLayout.vue';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const { isDark, toggleTheme } = useTheme();

const form = reactive({ username: '', password: '' });
const loading = ref(false);

async function onSubmit() {
  if (!form.username || !form.password) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
  loading.value = true;
  try {
    await auth.login(form.username, form.password);
    if (!auth.isLoggedIn) {
      ElMessage.error('登录失败：未能获取令牌');
      return;
    }
    const redirect = (route.query.redirect as string) || '/dashboard';
    router.push(redirect);
  } catch {
    /* 错误已由 axios 拦截器统一提示 */
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login {
  position: relative;
  width: 400px;
  max-width: 92vw;
}
.login__theme {
  position: absolute;
  top: -52px;
  right: 0;
  width: 38px;
  height: 38px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: color var(--motion-fast) var(--ease-out),
    border-color var(--motion-fast) var(--ease-out);
}
.login__theme:hover { color: var(--c-primary); border-color: var(--c-primary); }

.login__card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: var(--space-8);
}
.login__brand {
  text-align: center;
  margin-bottom: var(--space-6);
}
.login__logo {
  width: 52px;
  height: 52px;
  margin: 0 auto var(--space-3);
  border-radius: var(--radius-md);
  background: var(--c-primary-50);
  color: var(--c-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.login__title {
  font-size: 19px;
  font-weight: 700;
  margin: 0;
  color: var(--c-text);
}
.login__subtitle {
  margin: var(--space-2) 0 0;
  font-size: 13px;
  color: var(--c-text-muted);
}
.login__submit { width: 100%; margin-top: var(--space-1); }
.login__hint {
  margin: var(--space-5) 0 0;
  text-align: center;
  font-size: 12px;
  color: var(--c-text-subtle);
}
.login__hint code {
  background: var(--c-surface-2);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
}
</style>
