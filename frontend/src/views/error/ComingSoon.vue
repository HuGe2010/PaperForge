<script setup lang="ts">
import { useRoute } from 'vue-router';

const route = useRoute();
const title = (route.meta.title as string) || '模块';
</script>

<template>
  <div class="coming-soon">
    <div class="coming-soon__badge">P2 框架已就绪</div>
    <h1 class="coming-soon__title">{{ title }}</h1>
    <p class="coming-soon__desc">
      该模块的业务界面将在后续阶段（P3 起）逐步落地。<br />
      当前你看到的是已贯穿设计令牌、亮暗主题与响应式规则的主框架。
    </p>
    <el-button type="primary" plain @click="$router.push('/dashboard')">
      返回数据看板
    </el-button>
  </div>
</template>

<style scoped>
.coming-soon {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--space-12) var(--space-6);
  min-height: 60vh;
  color: var(--c-text-muted);
}
.coming-soon__badge {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-primary);
  background: var(--c-primary-50);
  border: 1px solid var(--c-primary-100);
  padding: 4px 12px;
  border-radius: var(--radius-pill);
  margin-bottom: var(--space-5);
}
.coming-soon__title {
  font-size: 26px;
  font-weight: 700;
  color: var(--c-text);
  margin: 0 0 var(--space-3);
}
.coming-soon__desc {
  font-size: 14px;
  line-height: 1.8;
  max-width: 460px;
  margin: 0 0 var(--space-6);
}
</style>
