<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import type {
  Subject,
  Tag,
  QuestionQuery,
  QuestionType,
  QuestionStatus,
  SourceType,
} from '../../types/models';
import { QUESTION_TYPE_OPTIONS } from '../../types/models';
import SubjectTree from './SubjectTree.vue';

const props = defineProps<{
  query: QuestionQuery;
  subjects: Subject[];
  tags: Tag[];
}>();
const emit = defineEmits<{ change: [] }>();

const STATUS_OPTIONS: { value: QuestionStatus; label: string }[] = [
  { value: 'DRAFT', label: '草稿' },
  { value: 'PUBLISHED', label: '已发布' },
  { value: 'ARCHIVED', label: '归档' },
];
const SOURCE_OPTIONS: { value: SourceType; label: string }[] = [
  { value: 'MANUAL', label: '手工' },
  { value: 'OCR', label: 'OCR' },
  { value: 'IMPORT', label: '导入' },
];

// 学科展开状态（默认展开一级）
const expanded = reactive<Record<string, boolean>>({});
function initExpanded() {
  props.subjects.forEach((s) => {
    if (s.children?.length && expanded[s.id] === undefined) expanded[s.id] = true;
  });
}
watch(() => props.subjects, initExpanded, { immediate: true });

function emitChange() {
  emit('change');
}

const selectedSubjectId = computed(() => props.query.subjectIds?.split(',')[0] ?? null);

function findNode(list: Subject[], id: string): Subject | null {
  for (const n of list) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const f = findNode(n.children, id);
      if (f) return f;
    }
  }
  return null;
}
function collectIds(node: Subject): string[] {
  const ids = [node.id];
  if (node.children?.length) for (const c of node.children) ids.push(...collectIds(c));
  return ids;
}
function findPath(list: Subject[], id: string, acc: string[] = []): string[] | null {
  for (const n of list) {
    const next = [...acc, n.id];
    if (n.id === id) return next;
    if (n.children?.length) {
      const f = findPath(n.children, id, next);
      if (f) return f;
    }
  }
  return null;
}

function selectSubject(id: string) {
  if (selectedSubjectId.value === id) {
    props.query.subjectIds = undefined;
  } else {
    const node = findNode(props.subjects, id);
    const ids = node ? collectIds(node) : [id];
    props.query.subjectIds = ids.join(',');
    // 展开选中节点所在路径，确保高亮可见
    const path = findPath(props.subjects, id);
    path?.forEach((pid) => (expanded[pid] = true));
  }
  emitChange();
}
function selectAllSubjects() {
  props.query.subjectIds = undefined;
  emitChange();
}
function toggleExpand(id: string) {
  expanded[id] = !expanded[id];
}

const difficultyModel = computed<number>({
  get: () => props.query.difficulty ?? 0,
  set: (v: number) => {
    props.query.difficulty = v || undefined;
    emitChange();
  },
});
const tagModel = computed<string | undefined>({
  get: () => props.query.tagId,
  set: (v) => {
    props.query.tagId = v;
    emitChange();
  },
});

function toggleType(v: QuestionType) {
  props.query.type = props.query.type === v ? undefined : v;
  emitChange();
}
function toggleStatus(v: QuestionStatus) {
  props.query.status = props.query.status === v ? undefined : v;
  emitChange();
}
function toggleSource(v: SourceType) {
  props.query.sourceType = props.query.sourceType === v ? undefined : v;
  emitChange();
}
function setDifficulty(d: number) {
  props.query.difficulty = props.query.difficulty === d ? undefined : d;
  emitChange();
}
function reset() {
  Object.keys(props.query).forEach((k) => ((props.query as Record<string, unknown>)[k] = undefined));
  emitChange();
}
</script>

<template>
  <aside class="filter">
    <div class="filter__head">
      <span class="filter__title">筛选</span>
      <el-button text size="small" :icon="'RefreshLeft'" @click="reset">重置</el-button>
    </div>

    <section class="filter__group">
      <div class="filter__label">学科</div>
      <button
        class="filter__all"
        :class="{ 'is-active': !selectedSubjectId }"
        @click="selectAllSubjects"
      >
        <el-icon><component :is="'Grid'" /></el-icon>
        <span>全部学科</span>
      </button>
      <div class="filter__tree">
        <SubjectTree
          :nodes="subjects"
          :selected-id="selectedSubjectId"
          :expanded="expanded"
          @select="selectSubject"
          @toggle="toggleExpand"
        />
      </div>
    </section>

    <section class="filter__group">
      <div class="filter__label">题型</div>
      <div class="filter__chips">
        <button
          v-for="o in QUESTION_TYPE_OPTIONS"
          :key="o.value"
          class="fchip"
          :class="{ active: query.type === o.value }"
          @click="toggleType(o.value)"
        >
          {{ o.label }}
        </button>
      </div>
    </section>

    <section class="filter__group">
      <div class="filter__label">难度</div>
      <div class="filter__stars">
        <button
          v-for="d in 5"
          :key="d"
          class="fstar"
          :class="{ active: (query.difficulty ?? 0) >= d }"
          :title="`${d} 星`"
          @click="setDifficulty(d)"
        >
          ★
        </button>
        <span v-if="query.difficulty" class="filter__stars-val">{{ query.difficulty }} 星</span>
        <button v-if="query.difficulty" class="filter__stars-clear" @click="setDifficulty(query.difficulty as number)">清除</button>
      </div>
    </section>

    <section class="filter__group">
      <div class="filter__label">状态</div>
      <div class="filter__chips">
        <button
          v-for="s in STATUS_OPTIONS"
          :key="s.value"
          class="fchip"
          :class="{ active: query.status === s.value }"
          @click="toggleStatus(s.value)"
        >
          {{ s.label }}
        </button>
      </div>
    </section>

    <section class="filter__group">
      <div class="filter__label">来源</div>
      <div class="filter__chips">
        <button
          v-for="s in SOURCE_OPTIONS"
          :key="s.value"
          class="fchip"
          :class="{ active: query.sourceType === s.value }"
          @click="toggleSource(s.value)"
        >
          {{ s.label }}
        </button>
      </div>
    </section>

    <section class="filter__group">
      <div class="filter__label">标签</div>
      <el-select v-model="tagModel" clearable placeholder="全部标签" size="default" style="width: 100%">
        <el-option v-for="t in tags" :key="t.id" :label="t.name" :value="t.id" />
      </el-select>
    </section>
  </aside>
</template>

<style scoped>
.filter {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-4);
  height: 100%;
  overflow: auto;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}
.filter__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: sticky;
  top: 0;
  background: var(--c-surface);
  z-index: 1;
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--c-border);
}
.filter__title {
  font-size: 15px;
  font-weight: 700;
  color: var(--c-text);
  letter-spacing: 0.02em;
}
.filter__group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.filter__label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--c-text-subtle);
}
.filter__all {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 34px;
  padding: 0 var(--space-3);
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-text-muted);
  border-radius: var(--radius-sm);
  font-size: 13.5px;
  cursor: pointer;
  transition: all var(--motion-fast) var(--ease-out);
}
.filter__all:hover {
  border-color: var(--c-primary);
  color: var(--c-primary);
}
.filter__all.is-active {
  background: var(--c-primary-50);
  border-color: var(--c-primary);
  color: var(--c-primary);
  font-weight: 600;
}
.filter__all .el-icon {
  font-size: 15px;
}
.filter__tree {
  margin-top: 2px;
}
.filter__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.fchip {
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-text-muted);
  border-radius: var(--radius-pill);
  padding: 5px 14px;
  font-size: 12.5px;
  cursor: pointer;
  transition: all var(--motion-fast) var(--ease-out);
}
.fchip:hover {
  border-color: var(--c-primary);
  color: var(--c-primary);
  background: var(--c-primary-50);
}
.fchip.active {
  background: var(--c-primary);
  border-color: var(--c-primary);
  color: #fff;
  box-shadow: var(--shadow-sm);
}
.filter__stars {
  display: flex;
  align-items: center;
  gap: 2px;
}
.fstar {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
  color: var(--c-border-strong);
  padding: 0 2px;
  transition: color var(--motion-fast) var(--ease-out), transform var(--motion-fast) var(--ease-out);
}
.fstar:hover {
  transform: scale(1.15);
  color: var(--c-warning);
}
.fstar.active {
  color: var(--c-warning);
}
.filter__stars-val {
  font-size: 12px;
  color: var(--c-text-muted);
  margin-left: 6px;
}
.filter__stars-clear {
  background: none;
  border: none;
  color: var(--c-text-subtle);
  font-size: 12px;
  cursor: pointer;
  margin-left: 4px;
  text-decoration: underline;
}
.filter__stars-clear:hover {
  color: var(--c-danger);
}
</style>
