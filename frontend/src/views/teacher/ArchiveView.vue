<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { questionsApi, type QuestionListResult } from '@/api/questions';
import { QUESTION_TYPE_LABEL, type QuestionListItem } from '@/types/models';
import MathText from '@/components/base/MathText.vue';

const loading = ref(false);
const data = ref<QuestionListItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

async function load() {
  loading.value = true;
  try {
    const r = (await questionsApi.list({
      status: 'ARCHIVED',
      page: page.value,
      pageSize: pageSize.value,
    })) as unknown as QuestionListResult;
    data.value = r.items;
    total.value = r.total;
  } catch {
    /* 拦截器已提示 */
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function restore(q: QuestionListItem) {
  try {
    await ElMessageBox.confirm('恢复后该题将重新出现在活跃题库。若它由合并产生，将一并撤销合并。', '恢复题目', {
      type: 'warning',
    });
  } catch {
    return;
  }
  try {
    const byMerge = await questionsApi.undoMergeByQuestion(q.id);
    if (byMerge.undone) {
      ElMessage.success('已撤销合并并恢复该题为活跃题目');
    } else {
      await questionsApi.restore(q.id);
      ElMessage.success('已恢复到活跃题库');
    }
    await load();
  } catch {
    /* 拦截器已提示 */
  }
}

function typeLabel(t: string): string {
  return (QUESTION_TYPE_LABEL as Record<string, string>)[t] || t;
}
</script>

<template>
  <div class="archive">
    <div class="archive__head">
      <h2 class="archive__title">归档</h2>
      <span class="archive__hint">合并产生的重复题会归档于此；可恢复（若由合并产生则一并撤销合并）。</span>
    </div>

    <div v-loading="loading">
      <el-empty v-if="!loading && !data.length" description="归档区为空" />

      <el-card v-for="q in data" :key="q.id" class="archive__item" shadow="hover">
        <div class="archive__item-meta">
          <el-tag size="small">{{ typeLabel(q.type) }}</el-tag>
          <span class="archive__stem"><MathText :value="q.stem" /></span>
        </div>
        <div class="archive__item-papers">
          <el-tag v-for="p in (q.sourcePapers || [])" :key="p" size="small" type="info" effect="plain">{{ p }}</el-tag>
        </div>
        <div class="archive__item-actions">
          <el-button type="primary" size="small" @click="restore(q)">恢复</el-button>
        </div>
      </el-card>

      <el-pagination
        v-if="total > pageSize"
        class="archive__pager"
        layout="prev, pager, next"
        :total="total"
        :page-size="pageSize"
        v-model:current-page="page"
        @current-change="load"
      />
    </div>
  </div>
</template>

<style scoped>
.archive { padding: var(--space-5); max-width: 1080px; margin: 0 auto; }
.archive__head { display: flex; align-items: baseline; gap: var(--space-3); margin-bottom: var(--space-4); flex-wrap: wrap; }
.archive__title { margin: 0; font-size: 20px; }
.archive__hint { color: var(--el-text-color-secondary); font-size: 13px; }
.archive__item {
  margin-bottom: var(--space-3);
  display: flex; align-items: center; gap: var(--space-3);
}
.archive__item-meta { flex: 1; min-width: 0; display: flex; gap: var(--space-2); align-items: flex-start; }
.archive__stem { flex: 1; min-width: 0; }
.archive__item-papers { display: flex; flex-wrap: wrap; gap: 4px; max-width: 320px; }
.archive__item-actions { flex-shrink: 0; }
.archive__pager { justify-content: center; margin-top: var(--space-4); }
</style>
