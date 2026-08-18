<script setup lang="ts">
import type { Subject } from '../../types/models';

const props = defineProps<{
  nodes: Subject[];
  selectedId?: string | null;
  expanded: Record<string, boolean>;
  level?: number;
}>();
const emit = defineEmits<{
  select: [id: string];
  toggle: [id: string];
}>();

const lv = () => props.level ?? 0;
</script>

<template>
  <ul class="stree" :class="{ 'stree--root': lv() === 0 }">
    <li v-for="node in nodes" :key="node.id" class="stree__item">
      <div
        class="stree__row"
        :class="{ 'is-active': selectedId === node.id }"
        :style="{ paddingLeft: lv() * 14 + 10 + 'px' }"
        @click="emit('select', node.id)"
      >
        <button
          v-if="node.children && node.children.length"
          class="stree__caret"
          :class="{ 'is-open': expanded[node.id] }"
          :aria-label="expanded[node.id] ? '收起' : '展开'"
          @click.stop="emit('toggle', node.id)"
        >
          <el-icon><component :is="expanded[node.id] ? 'CaretBottom' : 'CaretRight'" /></el-icon>
        </button>
        <span v-else class="stree__caret is-leaf" />

        <span class="stree__label">{{ node.name }}</span>
        <span v-if="node.children && node.children.length" class="stree__count">{{ node.children.length }}</span>
      </div>

      <SubjectTree
        v-if="node.children && node.children.length && expanded[node.id]"
        :nodes="node.children"
        :selected-id="selectedId"
        :expanded="expanded"
        :level="lv() + 1"
        @select="emit('select', $event)"
        @toggle="emit('toggle', $event)"
      />
    </li>
  </ul>
</template>

<style scoped>
.stree {
  list-style: none;
  margin: 0;
  padding: 0;
}
.stree__item {
  margin: 0;
}
.stree__row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 34px;
  padding-right: var(--space-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--c-text);
  position: relative;
  transition: background-color var(--motion-fast) var(--ease-out),
    color var(--motion-fast) var(--ease-out);
  user-select: none;
}
.stree__row:hover {
  background: var(--c-surface-2);
}
.stree__row.is-active {
  background: var(--c-primary-50);
  color: var(--c-primary);
  font-weight: 600;
}
/* 选中左侧主色条 */
.stree__row.is-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: var(--radius-pill);
  background: var(--c-primary);
}
.stree__caret {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--c-text-subtle);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background-color var(--motion-fast) var(--ease-out),
    transform var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out);
}
.stree__caret:hover {
  background: var(--c-border);
  color: var(--c-text-muted);
}
.stree__caret .el-icon,
.stree__caret svg {
  font-size: 14px;
}
.stree__caret.is-open .el-icon {
  transform: rotate(0deg);
}
.stree__caret.is-leaf {
  cursor: default;
}
.stree__label {
  flex: 1 1 auto;
  font-size: 13.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stree__count {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--c-text-subtle);
  background: var(--c-surface-2);
  border-radius: var(--radius-pill);
  padding: 0 7px;
  line-height: 18px;
}
.stree__row.is-active .stree__count {
  background: var(--c-primary-100);
  color: var(--c-primary-active);
}
</style>
