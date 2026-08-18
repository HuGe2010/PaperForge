<script setup lang="ts">
import { computed, useSlots, ref } from 'vue';
import { useBreakpoint } from '../../composables/useBreakpoint';

export interface TableColumn {
  prop: string;
  label: string;
  width?: string | number;
  minWidth?: string | number;
  align?: 'left' | 'center' | 'right';
  /** 指定具名插槽名（桌面与移动端通用），缺省显示 row[prop] 文本 */
  slot?: string;
  /** 移动端卡片是否隐藏该列 */
  hideOnCard?: boolean;
}

const props = withDefaults(
  defineProps<{
    columns: TableColumn[];
    data: Record<string, any>[];
    rowKey: string;
    loading?: boolean;
    emptyText?: string;
    /** 移动端卡片标题使用的列 prop */
    cardTitleKey?: string;
    /** 是否开启行选择（桌面端复选框列 + 移动端卡片复选框） */
    selectable?: boolean;
  }>(),
  { loading: false, emptyText: '暂无数据', cardTitleKey: '', selectable: false },
);

const emit = defineEmits<{
  'selection-change': [rows: Record<string, any>[]];
}>();

const slots = useSlots();
const { isMobile } = useBreakpoint();
const cardMode = computed(() => isMobile.value);

const titleKey = computed(
  () => props.cardTitleKey || props.columns[0]?.prop || 'id',
);

// 移动端选择态：用 rowKey 集合记录，避免响应式对象比较问题
const selectedKeys = ref<Set<string>>(new Set());
const dataMap = computed(() => {
  const m = new Map<string, Record<string, any>>();
  for (const row of props.data) m.set(row[props.rowKey], row);
  return m;
});

function onSelectionChange(rows: Record<string, any>[]) {
  emit('selection-change', rows);
}

function isCardSelected(row: Record<string, any>): boolean {
  return selectedKeys.value.has(row[props.rowKey]);
}

function onCardCheck(row: Record<string, any>, checked: boolean) {
  const key = row[props.rowKey];
  const next = new Set(selectedKeys.value);
  if (checked) next.add(key);
  else next.delete(key);
  selectedKeys.value = next;
  const rows = Array.from(next)
    .map((k) => dataMap.value.get(k))
    .filter(Boolean) as Record<string, any>[];
  emit('selection-change', rows);
}

// 桌面端 el-table 引用，用于清空选择
const tableRef = ref<any>(null);
function clearSelection() {
  tableRef.value?.clearSelection?.();
  selectedKeys.value = new Set();
  emit('selection-change', []);
}
defineExpose({ clearSelection });
</script>

<template>
  <div class="responsive-table">
    <!-- 桌面端：el-table -->
    <el-table
      v-if="!cardMode"
      ref="tableRef"
      v-loading="loading"
      :data="data"
      :row-key="rowKey"
      stripe
      border
      size="default"
      style="width: 100%"
      @selection-change="onSelectionChange"
    >
      <el-table-column v-if="selectable" type="selection" width="48" :reserve-selection="false" />
      <el-table-column
        v-for="col in columns"
        :key="col.prop"
        :prop="col.prop"
        :label="col.label"
        :width="col.width"
        :min-width="col.minWidth"
        :align="col.align || 'left'"
      >
        <template #default="{ row }">
          <slot v-if="col.slot || slots[col.prop]" :name="col.slot || col.prop" :row="row" :value="row[col.prop]" />
          <span v-else>{{ row[col.prop] }}</span>
        </template>
      </el-table-column>
      <template #empty>
        <slot name="empty">{{ emptyText }}</slot>
      </template>
    </el-table>

    <!-- 移动端：卡片列表 -->
    <div v-else class="responsive-table__cards">
      <el-skeleton v-if="loading" :rows="4" animated />
      <p v-else-if="!data.length" class="responsive-table__empty">{{ emptyText }}</p>
      <div v-else v-for="row in data" :key="row[rowKey]" class="responsive-table__card">
        <div class="responsive-table__card-head">
          <el-checkbox
            v-if="selectable"
            :model-value="isCardSelected(row)"
            @change="(v: any) => onCardCheck(row, !!v)"
          />
          <div class="responsive-table__card-title">
            <slot name="card-title" :row="row">{{ row[titleKey] }}</slot>
          </div>
        </div>
        <div
          v-for="col in columns.filter((c) => !c.hideOnCard && c.prop !== titleKey)"
          :key="col.prop"
          class="responsive-table__card-row"
        >
          <span class="responsive-table__card-label">{{ col.label }}</span>
          <span class="responsive-table__card-value">
            <slot v-if="col.slot || slots[col.prop]" :name="col.slot || col.prop" :row="row" :value="row[col.prop]" />
            <template v-else>{{ row[col.prop] }}</template>
          </span>
        </div>
        <div v-if="slots['card-actions']" class="responsive-table__card-actions">
          <slot name="card-actions" :row="row" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.responsive-table__cards {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.responsive-table__empty {
  text-align: center;
  color: var(--c-text-muted);
  padding: var(--space-8);
}
.responsive-table__card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  box-shadow: var(--shadow-sm);
}
.responsive-table__card-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.responsive-table__card-title {
  font-weight: 600;
  font-size: 15px;
  color: var(--c-text);
  margin-bottom: var(--space-3);
}
.responsive-table__card-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-1) 0;
  font-size: 13px;
}
.responsive-table__card-label { color: var(--c-text-subtle); flex: 0 0 auto; }
.responsive-table__card-value { color: var(--c-text); text-align: right; }
.responsive-table__card-actions {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--c-border);
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}
</style>
