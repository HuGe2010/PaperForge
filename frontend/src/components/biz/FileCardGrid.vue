<script setup lang="ts">
interface FileItem {
  id: string;
  name: string;
  subjectId: string | null;
  count: number;
  pageId: string | null;
}

const props = defineProps<{
  files: FileItem[];
  type: 'paper' | 'workbook';
  subjectNameMap: Record<string, string>;
  loading?: boolean;
}>();
const emit = defineEmits<{
  open: [row: FileItem];
  viewOriginal: [row: FileItem];
}>();
</script>

<template>
  <div v-loading="loading" class="fgrid-wrap">
    <el-empty v-if="!files.length && !loading" :description="type === 'paper' ? '暂无试卷' : '暂无作业本'" :image-size="64" />
    <div v-else class="fgrid">
      <article
        v-for="f in files"
        :key="f.id"
        class="fcard"
        @click="emit('open', f)"
      >
        <div class="fcard__top">
          <span class="fcard__icon">
            <el-icon size="20"><component :is="type === 'paper' ? 'Document' : 'Notebook'" /></el-icon>
          </span>
          <span class="fcard__count">{{ f.count }} 题</span>
        </div>
        <h3 class="fcard__name" :title="f.name">{{ f.name }}</h3>
        <div class="fcard__meta">
          <el-tag size="small" effect="plain" type="info">
            {{ f.subjectId ? (subjectNameMap[f.subjectId] || '未知学科') : '未分类学科' }}
          </el-tag>
        </div>
        <div class="fcard__actions" @click.stop>
          <el-button text type="primary" size="small" :icon="'View'" @click="emit('open', f)">查看</el-button>
          <el-button
            v-if="f.pageId"
            text
            type="primary"
            size="small"
            :icon="'Picture'"
            @click="emit('viewOriginal', f)"
          >
            看原卷
          </el-button>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.fgrid-wrap {
  min-height: 200px;
}
.fgrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-4);
}
.fcard {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  background: var(--c-surface);
  cursor: pointer;
  transition: border-color var(--motion-base) var(--ease-out),
    box-shadow var(--motion-base) var(--ease-out),
    transform var(--motion-base) var(--ease-out);
}
.fcard:hover {
  border-color: var(--c-primary);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}
.fcard__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.fcard__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--c-primary-50, #eef2ff);
  color: var(--c-primary);
}
.fcard__count {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-muted);
  background: var(--c-surface-2);
  border-radius: var(--radius-pill);
  padding: 2px 10px;
}
.fcard__name {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--c-text);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 42px;
}
.fcard__meta {
  min-height: 24px;
}
.fcard__actions {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
  padding-top: var(--space-2);
  border-top: 1px solid var(--c-border);
  margin-top: auto;
}
</style>
