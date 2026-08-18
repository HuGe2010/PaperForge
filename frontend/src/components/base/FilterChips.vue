<script setup lang="ts">
export interface FilterItem {
  /** 唯一键，用于删除回调 */
  key: string;
  /** 显示标签，如「学科」 */
  label: string;
  /** 显示值，如「数学」 */
  value: string;
}

defineProps<{
  filters: FilterItem[];
}>();

const emit = defineEmits<{
  (e: 'remove', key: string): void;
  (e: 'clear'): void;
}>();
</script>

<template>
  <div v-if="filters.length" class="filter-chips">
    <span
      v-for="f in filters"
      :key="f.key"
      class="filter-chips__chip"
    >
      <span class="filter-chips__label">{{ f.label }}</span>
      <span class="filter-chips__value">{{ f.value }}</span>
      <button
        type="button"
        class="filter-chips__close"
        :aria-label="`移除筛选 ${f.label} ${f.value}`"
        @click="emit('remove', f.key)"
      >
        ×
      </button>
    </span>
    <button type="button" class="filter-chips__clear" @click="emit('clear')">清空</button>
  </div>
</template>

<style scoped>
.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}
.filter-chips__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 4px 4px 4px 10px;
  background: var(--c-surface-2);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-pill);
  font-size: 13px;
  color: var(--c-text);
}
.filter-chips__label { color: var(--c-text-subtle); }
.filter-chips__value { font-weight: 600; }
.filter-chips__close {
  border: none;
  background: transparent;
  color: var(--c-text-muted);
  cursor: pointer;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-pill);
  line-height: 1;
  font-size: 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.filter-chips__close:hover { background: var(--c-border); color: var(--c-danger); }
.filter-chips__clear {
  border: none;
  background: transparent;
  color: var(--c-primary);
  cursor: pointer;
  font-size: 13px;
  padding: 2px 6px;
}
.filter-chips__clear:hover { text-decoration: underline; }
</style>
