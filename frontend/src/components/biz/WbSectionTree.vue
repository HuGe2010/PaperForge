<script setup lang="ts">
import { ref } from 'vue';
import type { WorkbookSectionNode } from '../../types/models';

const props = defineProps<{
  nodes: WorkbookSectionNode[];
  selectedId: string | null;
  level?: number;
  /** 是否可编辑章节（新建/子章节/重命名/删除）。view 态传 false 变只读树 */
  editable?: boolean;
}>();

const emit = defineEmits<{
  select: [id: string];
  addChild: [id: string];
  rename: [node: WorkbookSectionNode];
  remove: [node: WorkbookSectionNode];
  move: [id: string, direction: 'up' | 'down'];
}>();

const expanded = ref<Record<string, boolean>>({});
function toggle(id: string) {
  expanded.value[id] = !expanded.value[id];
}
</script>

<template>
  <ul class="wbtree" :style="{ '--lvl': level || 0 }">
    <li v-for="n in nodes" :key="n.id" class="wbtree__node">
      <div class="wbtree__row" :class="{ 'is-selected': selectedId === n.id }" @click="emit('select', n.id)">
        <span
          class="wbtree__caret"
          :class="{ 'wbtree__caret--leaf': !n.children?.length }"
          @click.stop="n.children?.length && toggle(n.id)"
        >{{ n.children?.length ? (expanded[n.id] ? '▾' : '▸') : '·' }}</span>
        <span class="wbtree__name">{{ n.name }}</span>
        <span v-if="editable" class="wbtree__acts" @click.stop>
          <el-button text size="small" :icon="'Top'" title="上移" @click="emit('move', n.id, 'up')" />
          <el-button text size="small" :icon="'Bottom'" title="下移" @click="emit('move', n.id, 'down')" />
          <el-button text size="small" :icon="'Plus'" title="添加子章节" @click="emit('addChild', n.id)" />
          <el-button text size="small" :icon="'Edit'" title="重命名" @click="emit('rename', n)" />
          <el-button text size="small" type="danger" :icon="'Delete'" title="删除章节" @click="emit('remove', n)" />
        </span>
      </div>
      <WbSectionTree
        v-if="n.children?.length && expanded[n.id]"
        :nodes="n.children"
        :selected-id="selectedId"
        :editable="editable"
        :level="(level || 0) + 1"
        @select="(id) => emit('select', id)"
        @add-child="(id) => emit('addChild', id)"
        @rename="(node) => emit('rename', node)"
        @remove="(node) => emit('remove', node)"
      />
    </li>
  </ul>
</template>

<style scoped>
.wbtree { list-style: none; margin: 0; padding: 0; }
.wbtree__node { margin: 0; }
.wbtree__row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  padding-left: calc(8px + var(--lvl) * 16px);
  border-radius: 6px;
  cursor: pointer;
  transition: background var(--motion-base) var(--ease-out);
}
.wbtree__row:hover { background: var(--c-surface-2); }
.wbtree__row.is-selected { background: var(--c-primary-50, #eef2ff); box-shadow: inset 2px 0 0 var(--c-primary); }
.wbtree__caret { flex: 0 0 auto; width: 16px; text-align: center; color: var(--c-text-subtle); font-size: 11px; user-select: none; }
.wbtree__caret--leaf { visibility: hidden; }
.wbtree__name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--c-text); }
.wbtree__acts { flex: 0 0 auto; display: none; gap: 0; }
.wbtree__row:hover .wbtree__acts { display: inline-flex; }
.wbtree__acts :deep(.el-button) { margin-left: 0; padding: 2px 4px; }
</style>
