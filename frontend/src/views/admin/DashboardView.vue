<template>
  <div>
    <h2 class="mb-2">欢迎回来，{{ auth.displayName }}</h2>
    <p class="muted mb-4">当前角色：{{ auth.roles.join('、') || '无' }}</p>

    <!-- AI 工作进度（像日志一样滚动展示：进行中进度条 + 最近任务记录） -->
    <el-card shadow="never" class="mb-4">
      <template #header>
        <div class="dash__head">
          <span>AI 工作进度</span>
          <el-button size="small" text :icon="'Refresh'" :loading="loading" @click="loadTasks">刷新</el-button>
        </div>
      </template>
      <div v-loading="loading" class="dash__tasks">
        <el-empty v-if="!tasks.length && !loading" description="暂无 AI 任务记录（自动框选 / AI 识别 / AI 解答）" :image-size="60" />
        <div
          v-for="t in tasks"
          :key="t.id"
          class="dash__task"
          :class="{ 'dash__task--clickable': !!t.jobId }"
          @click="gotoTask(t)"
        >
          <div class="dash__task-row">
            <el-tag size="small" :type="(TASK_TYPE_TAG[t.type] || 'info') as any" effect="plain">
              {{ TASK_TYPE_LABEL[t.type] || t.type }}
            </el-tag>
            <span class="dash__task-title" :title="t.title">{{ t.title }}</span>
            <el-tag size="small" :type="statusType(t.status)" effect="plain">{{ statusLabel(t.status) }}</el-tag>
            <span class="dash__task-time">{{ formatTime(t.updatedAt) }}</span>
          </div>
          <el-progress
            v-if="t.status === 'RUNNING'"
            :percentage="t.percent ?? 0"
            :stroke-width="4"
            :format="() => t.message || progressText(t)"
            class="dash__task-progress"
          />
          <div v-else class="dash__task-msg">{{ t.message || progressText(t) }}</div>
        </div>
      </div>
    </el-card>

    <el-card shadow="never">
      <template #header>系统状态</template>
      <p class="muted">
        数据看板将在 P10 阶段填充：题库结构、难度分布、知识点覆盖热力、成绩分析等图表。
      </p>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { aiTasksApi } from '@/api/aiTasks';
import type { AiTaskLog } from '@/types/models';

const auth = useAuthStore();
const router = useRouter();
const loading = ref(false);
const tasks = ref<AiTaskLog[]>([]);

/** 点击进度条目 → 跳转原页面（detect/recognize → 录入任务审阅台，solve → 题库详情） */
function gotoTask(t: AiTaskLog) {
  if (!t.jobId) return;
  if (t.type === 'solve') router.push(`/teacher/questions/${t.jobId}`);
  else router.push({ path: '/teacher/ingest', query: { jobId: t.jobId } });
}

const TASK_TYPE_LABEL: Record<string, string> = { detect: 'AI 框选', recognize: 'AI 识别', solve: 'AI 解答' };
const TASK_TYPE_TAG: Record<string, string> = { detect: 'warning', recognize: 'primary', solve: 'success' };
const statusLabel = (s: string) => (s === 'RUNNING' ? '进行中' : s === 'DONE' ? '完成' : s === 'FAILED' ? '失败' : s);
const statusType = (s: string) => (s === 'RUNNING' ? 'warning' : s === 'DONE' ? 'success' : s === 'FAILED' ? 'danger' : 'info');
const progressText = (t: AiTaskLog) =>
  t.total ? `${t.done ?? 0}/${t.total}${t.type === 'detect' ? ' 页' : ' 题'}` : '处理中…';
const formatTime = (s?: string) => {
  if (!s) return '';
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

let timer: ReturnType<typeof setInterval> | null = null;
async function loadTasks() {
  loading.value = true;
  try {
    const res = await aiTasksApi.list({ limit: 50 });
    tasks.value = res.items;
  } catch {
    /* 拦截器已提示 */
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadTasks();
  timer = setInterval(loadTasks, 5000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.mb-2 { margin-bottom: 8px; }
.mb-4 { margin-bottom: 16px; }
.muted { color: var(--c-text-muted); }
.dash__head { display: flex; justify-content: space-between; align-items: center; }
.dash__tasks { display: flex; flex-direction: column; gap: var(--space-2); max-height: 420px; overflow: auto; }
.dash__task {
  display: flex; flex-direction: column; gap: 4px;
  padding: 8px 10px; border: 1px solid var(--c-border); border-radius: 6px;
  background: var(--c-surface);
}
.dash__task--clickable { cursor: pointer; transition: border-color .15s, background .15s; }
.dash__task--clickable:hover { border-color: var(--c-primary); background: var(--c-bg-soft, #f5f7fa); }
.dash__task-row { display: flex; align-items: center; gap: 8px; }
.dash__task-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.dash__task-time { font-size: 11px; color: var(--c-text-subtle); white-space: nowrap; }
.dash__task-progress { font-size: 11px; }
.dash__task-msg { font-size: 12px; color: var(--c-text-muted); }
</style>
