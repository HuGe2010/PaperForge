<script setup lang="ts">
defineProps<{
  title?: string;
  description?: string;
  /** 简易线性图标名：inbox / search / doc / image */
  icon?: 'inbox' | 'search' | 'doc' | 'image';
}>();

const paths: Record<string, string> = {
  inbox: 'M3 12h4l2 3h6l2-3h4M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  doc: 'M7 3h7l4 4v14H7zM14 3v4h4',
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5',
};
</script>

<template>
  <div class="empty-state">
    <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path :d="paths[icon || 'inbox']" />
    </svg>
    <p class="empty-state__title">{{ title || '暂无数据' }}</p>
    <p v-if="description" class="empty-state__desc">{{ description }}</p>
    <div v-if="$slots.action" class="empty-state__action">
      <slot name="action" />
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-12) var(--space-6);
  color: var(--c-text-muted);
  text-align: center;
}
.empty-state__icon {
  width: 56px;
  height: 56px;
  color: var(--c-text-subtle);
  margin-bottom: var(--space-4);
}
.empty-state__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--c-text);
}
.empty-state__desc {
  margin: var(--space-2) 0 0;
  font-size: 13px;
  max-width: 360px;
}
.empty-state__action {
  margin-top: var(--space-5);
}
</style>
