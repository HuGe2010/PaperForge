<script setup lang="ts">
import type { QuestionListItem, QuestionStatus } from '../../types/models';
import { QUESTION_TYPE_LABEL } from '../../types/models';
import MathText from '../base/MathText.vue';

const props = defineProps<{
  data: QuestionListItem[];
  loading?: boolean;
}>();

const emit = defineEmits<{
  open: [row: QuestionListItem];
  delete: [row: QuestionListItem];
}>();

const STATUS_LABEL: Record<QuestionStatus, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  ARCHIVED: '归档',
};
const statusType = (s: QuestionStatus) =>
  s === 'PUBLISHED' ? 'success' : s === 'DRAFT' ? 'info' : 'warning';
const SOURCE_LABEL: Record<string, string> = {
  MANUAL: '手工',
  OCR: 'OCR',
  IMPORT: '导入',
};
</script>

<template>
  <div v-loading="loading" class="qgrid-wrap">
    <el-empty v-if="!data.length && !loading" description="题库空空如也，点击「新建题目」开始录入" :image-size="64" />
    <div v-else class="qgrid">
      <article v-for="row in data" :key="row.id" class="qcard">
        <div class="qcard__head">
          <el-tag size="small" effect="plain">{{ QUESTION_TYPE_LABEL[row.type] }}</el-tag>
          <el-rate :model-value="row.difficulty" disabled size="small" />
        </div>
        <div class="qcard__stem" @click="emit('open', row)">
          <MathText :value="row.stem" />
        </div>
        <div class="qcard__meta">
          <span class="qcard__subject">{{ row.subject?.name || '—' }}</span>
          <span v-if="row.tags.length" class="qcard__tags">
            <el-tag v-for="t in row.tags" :key="t.id" size="small" effect="plain" type="info" class="qcard__tag">
              {{ t.name }}
            </el-tag>
          </span>
        </div>
        <div class="qcard__foot">
          <div class="qcard__badges">
            <el-tag :type="statusType(row.status)" size="small">{{ STATUS_LABEL[row.status] }}</el-tag>
            <span class="qcard__src">{{ SOURCE_LABEL[row.sourceType] || row.sourceType }}</span>
          </div>
          <div class="qcard__actions" @click.stop>
            <el-button text type="primary" size="small" @click="emit('open', row)">查看</el-button>
            <el-button text type="primary" size="small" @click="emit('open', row)">编辑</el-button>
            <el-button text type="danger" size="small" @click="emit('delete', row)">删除</el-button>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.qgrid-wrap {
  min-height: 200px;
}
.qgrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-4);
}
.qcard {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  background: var(--c-surface);
  position: relative;
  overflow: hidden;
  transition: border-color var(--motion-base) var(--ease-out),
    box-shadow var(--motion-base) var(--ease-out),
    transform var(--motion-base) var(--ease-out);
}
.qcard::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--c-primary);
  transform: scaleY(0);
  transform-origin: top;
  transition: transform var(--motion-base) var(--ease-out);
}
.qcard:hover::before {
  transform: scaleY(1);
}
.qcard:hover {
  border-color: var(--c-primary);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}
.qcard__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.qcard__stem {
  font-size: 14px;
  line-height: 1.6;
  color: var(--c-text);
  cursor: pointer;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 64px;
  transition: color var(--motion-fast) var(--ease-out);
}
.qcard__stem:hover {
  color: var(--c-primary);
}
.qcard__meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.qcard__subject {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  font-size: 12px;
  color: var(--c-text-muted);
  background: var(--c-surface-2);
  border-radius: var(--radius-pill);
  padding: 2px 10px;
}
.qcard__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.qcard__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--c-border);
  margin-top: auto;
}
.qcard__badges {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.qcard__src {
  font-size: 12px;
  color: var(--c-text-subtle);
}
.qcard__actions {
  display: flex;
  gap: 2px;
}
</style>
