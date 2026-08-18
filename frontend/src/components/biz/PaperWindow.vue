<script setup lang="ts">
import { ref, computed, watch, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { questionsApi } from '../../api/questions';
import { ingestApi } from '../../api/ingest';
import { subjectsApi } from '../../api/subjects';
import { usePaperWindow } from '../../composables/usePaperWindow';
import { QUESTION_TYPE_LABEL, type QuestionType, type Subject } from '../../types/models';
import MathText from '../base/MathText.vue';

/**
 * 试卷 / 作业本浏览窗口（全局单例，右侧抽屉）：
 * - 题库「按试卷 / 按作业本」tab 点试卷名 → 打开；
 * - 题目详情页点「来源试卷」→ 打开同一个窗口；
 * - 按大题分组展示题目，点击题目关闭抽屉并跳转到详情；
 * - 「编辑试卷」：内联到抽屉（改名 / 题目排序 / 大题修改 / 大题组排序）；
 * - 「添加题目到试卷」：抽屉加宽，左侧本卷预览、右侧题库勾选，追加归属（不新建记录）。
 */
const router = useRouter();
const { state, close } = usePaperWindow();

// 作业本走独立的 WorkbookWindow（已挂载在布局中），本组件只负责试卷
const paperVisible = computed(() => state.visible && state.type === 'paper');

// 同一页面三种模式：view 浏览 / edit 编辑 / add 添加题目
const mode = ref<'view' | 'edit' | 'add'>('view');
const drawerSize = computed(() => (mode.value === 'add' ? '72%' : mode.value === 'edit' ? '48%' : '38%'));

const paperItems = ref<any[]>([]);
const paperLoading = ref(false);
const paperTotal = ref(0);
const paperPage = ref(1);
// 试卷窗口一次性加载整卷，保证「按题号全卷排序」是全局顺序（而非分页截断）
const paperPageSize = ref(1000);

const paperGroups = computed(() => {
  const map = new Map<string, { key: string; title: string; groupIndex: number | null; items: any[] }>();
  for (const it of paperItems.value) {
    const gi = (it as any).groupIndex as number | null | undefined;
    const gt = (it as any).groupTitle as string | null | undefined;
    const key = gi != null ? `g${gi}` : '__none__';
    const title = gt || (gi != null ? `第 ${gi} 大题` : '未分组');
    let g = map.get(key);
    if (!g) {
      g = { key, title, groupIndex: gi ?? null, items: [] };
      map.set(key, g);
    }
    g.items.push(it);
  }
  const groups = Array.from(map.values());
  // 组序：按 groupIndex 升序，未分组(null) 排最后
  groups.sort((a, b) => {
    const ai = a.groupIndex ?? Number.MAX_SAFE_INTEGER;
    const bi = b.groupIndex ?? Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
  // 组内：按 number 升序（与保存的题号绑定，不依赖接口返回顺序）
  groups.forEach((g) => {
    g.items.sort((a, b) => {
      const an = (a.number as number | null) ?? Number.MAX_SAFE_INTEGER;
      const bn = (b.number as number | null) ?? Number.MAX_SAFE_INTEGER;
      return an - bn;
    });
  });
  return groups;
});

async function loadPaperItems() {
  paperLoading.value = true;
  try {
    // 关键：显式按 number 升序，保证窗口展示顺序 == 保存的题号顺序
    const query: any = { page: paperPage.value, pageSize: paperPageSize.value, sortBy: 'number', order: 'asc' };
    if (state.type === 'paper') query.sourcePaper = state.name;
    else query.sourceFileId = state.jobId;
    const res = await questionsApi.list(query);
    paperItems.value = res.items;
    paperTotal.value = res.total;
  } catch {
    /* 拦截器已提示 */
  } finally {
    paperLoading.value = false;
  }
}

watch(
  () => state.visible,
  (v) => {
    if (v) {
      mode.value = 'view';
      paperPage.value = 1;
      loadPaperItems();
    }
  },
);

function goDetail(row: any) {
  // 关闭右侧试卷侧边栏，跳转到题目详情
  state.visible = false;
  router.push(`/teacher/questions/${row.id}`);
}

// ---------------- 编辑试卷：改名 / 题目排序 / 大题修改（内联到抽屉） ----------------
const editName = ref('');
const editSaving = ref(false);
interface EditGroup {
  title: string;
  groupIndex: number | null;
  items: any[];
}
const editGroups = ref<EditGroup[]>([]);

function enterEdit() {
  // 用当前加载的题目初始化编辑结构；未分组归入「未分组」组
  editName.value = state.name;
  const map = new Map<string, EditGroup>();
  for (const it of paperItems.value) {
    const gi = (it as any).groupIndex as number | null | undefined;
    const gt = (it as any).groupTitle as string | null | undefined;
    const key = gi != null ? `g${gi}` : '__none__';
    const title = gt || (gi != null ? `第 ${gi} 大题` : '未分组');
    let g = map.get(key);
    if (!g) {
      g = { title, groupIndex: gi ?? null, items: [] };
      map.set(key, g);
    }
    g.items.push(it);
  }
  const groups = Array.from(map.values());
  // 组序：按 groupIndex 升序（未分组排最后），与窗口展示一致
  groups.sort((a, b) => {
    const ai = a.groupIndex ?? Number.MAX_SAFE_INTEGER;
    const bi = b.groupIndex ?? Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
  // 组内：按 number 升序（稳定顺序）
  groups.forEach((g) => g.items.sort((a, b) => {
    const an = (a.number as number | null) ?? Number.MAX_SAFE_INTEGER;
    const bn = (b.number as number | null) ?? Number.MAX_SAFE_INTEGER;
    return an - bn;
  }));
  editGroups.value = groups;
  mode.value = 'edit';
}

/** 把题目移到目标大题组指定下标（拖拽落点）；atIndex 基于「已移除被拖题」的列表顺序，落点即占位位置 */
function moveItemToGroup(item: any, targetGi: number, atIndex: number) {
  for (const g of editGroups.value) {
    const i = g.items.findIndex((x) => x.id === item.id);
    if (i >= 0) g.items.splice(i, 1);
  }
  const target = editGroups.value[targetGi];
  if (!target) return;
  const idx = Math.max(0, Math.min(atIndex, target.items.length));
  target.items.splice(idx, 0, item);
}
function addGroup() {
  const name = `第 ${editGroups.value.length + 1} 大题`;
  editGroups.value.push({ title: name, groupIndex: null, items: [] });
}
function onDeleteGroup(g: EditGroup) {
  // 仅允许删除空大题组，避免误删导致整组题目丢失；非空需先把题移出
  if (g.items.length > 0) {
    ElMessage.warning('该大题组还有题目，请先把题目拖出后再删除');
    return;
  }
  const i = editGroups.value.findIndex((x) => x === g);
  if (i >= 0) editGroups.value.splice(i, 1);
}
/** 小题右侧 ×：从编辑工作集移除（本地），并立即从本卷 sourcePapers 剔除（持久化） */
async function removeItem(item: any) {
  for (const g of editGroups.value) {
    const i = g.items.findIndex((x) => x.id === item.id);
    if (i >= 0) g.items.splice(i, 1);
  }
  if (state.name) {
    try {
      await questionsApi.removeFromPaper(state.name, [item.id]);
    } catch {
      /* 拦截器已提示 */
    }
  }
}

/** 题号：按「组序 + 组内顺序」从上往下连续 1..N，实时反映当前排布（保存即按此重排） */
const editNumberMap = computed(() => {
  const map: Record<string, number> = {};
  let no = 1;
  for (const g of editGroups.value) for (const it of g.items) map[it.id] = no++;
  return map;
});

// -------- 拖拽：小题归属大题组（含组内重排）+ 大题组排序 --------
// itemDrag：被拖小题跟随指针；overGroupIdx/overIndex 决定占位落点，其他小题自动避让
const itemDrag = ref<{ id: string; item: any; x: number; y: number; overGroupIdx: number | null; overIndex: number } | null>(null);
function onItemDown(e: PointerEvent, item: any) {
  e.preventDefault();
  const gi = currentGroupOf(item.id);
  const g = editGroups.value[gi];
  const startIdx = g ? g.items.findIndex((x) => x.id === item.id) : 0;
  itemDrag.value = { id: item.id, item, x: e.clientX, y: e.clientY, overGroupIdx: gi, overIndex: startIdx };
  window.addEventListener('pointermove', onItemMove);
  window.addEventListener('pointerup', onItemUp);
}
function groupElAt(x: number, y: number): number | null {
  const els = document.elementsFromPoint(x, y) as HTMLElement[];
  for (const el of els) {
    const g = el.closest?.('.pe__group');
    if (g && g.getAttribute('data-gi') != null) return Number(g.getAttribute('data-gi'));
  }
  return null;
}
function computeItemInsertIndex(gi: number, y: number): number {
  const g = editGroups.value[gi];
  if (!g) return 0;
  const container = document.querySelector(`.pe__group[data-gi="${gi}"] .pe__items`) as HTMLElement | null;
  if (!container) return g.items.length;
  const els = Array.from(container.querySelectorAll('.pe__item')) as HTMLElement[];
  let idx = 0;
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    if (y > rect.top + rect.height / 2) idx++;
    else break;
  }
  return idx;
}
function onItemMove(e: PointerEvent) {
  const d = itemDrag.value;
  if (!d) return;
  d.x = e.clientX;
  d.y = e.clientY;
  const gi = groupElAt(e.clientX, e.clientY);
  d.overGroupIdx = gi;
  if (gi != null) d.overIndex = computeItemInsertIndex(gi, e.clientY);
}
function onItemUp() {
  const d = itemDrag.value;
  window.removeEventListener('pointermove', onItemMove);
  window.removeEventListener('pointerup', onItemUp);
  itemDrag.value = null;
  if (!d) return;
  const item = findItem(d.id);
  if (!item || d.overGroupIdx == null) return;
  moveItemToGroup(item, d.overGroupIdx, d.overIndex);
}
type ItemEntry = { kind: 'ph'; key: string } | { kind: 'item'; key: string; it: any; oi: number };
/** 编辑态某组的展示列表：拖拽中隐藏被拖题，并在 overIndex 处插入虚线占位（驱动其他题避让） */
function displayList(gi: number): ItemEntry[] {
  const g = editGroups.value[gi];
  if (!g) return [];
  const d = itemDrag.value;
  const draggedId = d?.id ?? null;
  const items = g.items.filter((it) => it.id !== draggedId);
  const out: ItemEntry[] = [];
  const phHere = !!d && d.overGroupIdx === gi;
  const phIdx = phHere ? Math.min(d!.overIndex, items.length) : -1;
  items.forEach((it, idx) => {
    if (idx === phIdx) out.push({ kind: 'ph', key: 'ph' });
    out.push({ kind: 'item', key: it.id, it, oi: g.items.indexOf(it) });
  });
  if (phHere && phIdx >= items.length) out.push({ kind: 'ph', key: 'ph' });
  return out;
}
function findItem(id: string): any | null {
  for (const g of editGroups.value) {
    const it = g.items.find((x) => x.id === id);
    if (it) return it;
  }
  return null;
}
function currentGroupOf(id: string): number {
  return editGroups.value.findIndex((g) => g.items.some((x) => x.id === id));
}

const groupDrag = ref<{ from: number; title: string; x: number; y: number; over: number } | null>(null);
function onGroupDown(e: PointerEvent, from: number) {
  e.preventDefault();
  const g = editGroups.value[from];
  groupDrag.value = { from, title: g?.title ?? '', x: e.clientX, y: e.clientY, over: from };
  window.addEventListener('pointermove', onGroupMove);
  window.addEventListener('pointerup', onGroupUp);
}
function computeGroupInsertIndex(y: number): number {
  const els = Array.from(document.querySelectorAll('.pe__group')) as HTMLElement[];
  let idx = 0;
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    if (y > rect.top + rect.height / 2) idx++;
    else break;
  }
  return idx;
}
function onGroupMove(e: PointerEvent) {
  const d = groupDrag.value;
  if (!d) return;
  d.x = e.clientX;
  d.y = e.clientY;
  d.over = computeGroupInsertIndex(e.clientY);
}
function onGroupUp() {
  const d = groupDrag.value;
  window.removeEventListener('pointermove', onGroupMove);
  window.removeEventListener('pointerup', onGroupUp);
  groupDrag.value = null;
  if (!d || d.over == null || d.over === d.from) return;
  const arr = editGroups.value;
  const [moved] = arr.splice(d.from, 1);
  let target = d.over;
  if (d.from < target) target -= 1;
  arr.splice(Math.max(0, Math.min(target, arr.length)), 0, moved);
}
type GroupEntry = { kind: 'ph'; key: string } | { kind: 'group'; key: string; g: EditGroup; gi: number };
/** 编辑态大题组展示列表：拖拽中隐藏被拖组，并在 over 处插入虚线占位（驱动其他组避让） */
function displayGroups(): GroupEntry[] {
  const d = groupDrag.value;
  const from = d?.from ?? -1;
  const entries = editGroups.value.map((g, gi) => ({ g, gi })).filter((x) => x.gi !== from);
  const out: GroupEntry[] = [];
  const phIdx = d ? Math.min(d.over, entries.length) : -1;
  entries.forEach((x, idx) => {
    if (idx === phIdx) out.push({ kind: 'ph', key: 'ph' });
    out.push({ kind: 'group', key: 'g' + x.gi, g: x.g, gi: x.gi });
  });
  if (d && phIdx >= entries.length) out.push({ kind: 'ph', key: 'ph' });
  return out;
}

async function saveEdit() {
  if (!state.jobId) return ElMessage.warning('缺少文件标识，无法保存（仅试卷可编辑）');
  editSaving.value = true;
  try {
    // 全卷题号重排：按组序 + 组内顺序，number 连续 1..N；groupIndex 组序 1..M
    const items: { id: string; number: number; groupIndex: number; groupTitle: string }[] = [];
    let no = 1;
    editGroups.value.forEach((g, gi) => {
      const groupIndex = gi + 1;
      g.items.forEach((it) => {
        items.push({ id: it.id, number: no++, groupIndex, groupTitle: g.title });
      });
    });
    await ingestApi.editPaper(state.jobId, { name: editName.value.trim(), items });
    ElMessage.success('已保存：名称 / 排序 / 大题已更新');
    // 更新窗口标题并刷新列表（保存自动刷新）
    state.name = editName.value.trim() || state.name;
    mode.value = 'view';
    await loadPaperItems();
  } catch {
    /* 拦截器已提示 */
  } finally {
    editSaving.value = false;
  }
}

// ---------------- 添加题目到试卷：左侧题库勾选 + 右侧本卷预览 ----------------
const bankQuery = reactive({ search: '', subjectId: '', type: '' as QuestionType | '' });
const bankItems = ref<any[]>([]);
const bankTotal = ref(0);
const bankPage = ref(1);
const bankPageSize = ref(50);
const bankLoading = ref(false);
const selectedItems = ref<any[]>([]);
const addReturnToEdit = ref(false);
const adding = ref(false);
const subjectOptions = ref<{ id: string; name: string }[]>([]);
const typeOptions = Object.entries(QUESTION_TYPE_LABEL).map(([value, label]) => ({ value, label })) as {
  value: string;
  label: string;
}[];

function isInPaper(it: any): boolean {
  return Array.isArray(it.sourcePapers) && (it.sourcePapers as string[]).includes(state.name);
}
function isSelected(id: string): boolean {
  return selectedItems.value.some((x) => x.id === id);
}
function toggleSelect(it: any) {
  if (isInPaper(it)) return;
  const i = selectedItems.value.findIndex((x) => x.id === it.id);
  if (i >= 0) selectedItems.value.splice(i, 1);
  else selectedItems.value.push(it);
}

async function loadSubjects() {
  try {
    const tree = (await subjectsApi.tree()) as unknown as Subject[];
    const flat: { id: string; name: string }[] = [];
    const walk = (nodes: any[]) => {
      for (const n of nodes || []) {
        flat.push({ id: n.id, name: n.name });
        if (Array.isArray(n.children) && n.children.length) walk(n.children);
      }
    };
    walk(tree);
    subjectOptions.value = flat;
  } catch {
    /* 忽略 */
  }
}

async function loadBank() {
  bankLoading.value = true;
  try {
    const q: any = { page: bankPage.value, pageSize: bankPageSize.value, sortBy: 'createdAt', order: 'desc' };
    if (bankQuery.search.trim()) q.search = bankQuery.search.trim();
    if (bankQuery.subjectId) q.subjectId = bankQuery.subjectId;
    if (bankQuery.type) q.type = bankQuery.type;
    const res = await questionsApi.list(q);
    bankItems.value = res.items;
    bankTotal.value = res.total;
  } catch {
    /* 拦截器已提示 */
  } finally {
    bankLoading.value = false;
  }
}

function enterAddFromEdit() {
  // 从编辑页进入「添加题目到试卷」：确认后并入编辑工作集（随整卷保存），而非切回浏览态
  addReturnToEdit.value = true;
  mode.value = 'add';
  selectedItems.value = [];
  bankQuery.search = '';
  bankQuery.subjectId = '';
  bankQuery.type = '';
  bankPage.value = 1;
  loadSubjects();
  loadBank();
}

function onBankFilterChange() {
  bankPage.value = 1;
  loadBank();
}

function cancelAdd() {
  selectedItems.value = [];
  if (addReturnToEdit.value) {
    addReturnToEdit.value = false;
    mode.value = 'edit';
  } else {
    mode.value = 'view';
  }
}

async function confirmAdd() {
  if (!selectedItems.value.length) return;
  if (!state.name) return ElMessage.warning('缺少试卷名，无法添加');
  adding.value = true;
  try {
    const res = await questionsApi.addToPaper(state.name, selectedItems.value.map((x) => x.id));
    ElMessage.success(`已添加 ${res.added} 题到「${state.name}」`);
    if (addReturnToEdit.value) {
      // 并入当前编辑工作集的「未分组」组，用户可拖到目标大题组，保存时整卷重排
      let none = editGroups.value.find((x) => x.title === '未分组');
      if (!none) {
        none = { title: '未分组', groupIndex: null, items: [] };
        editGroups.value.push(none);
      }
      for (const it of selectedItems.value) none.items.push(it);
      selectedItems.value = [];
      addReturnToEdit.value = false;
      mode.value = 'edit';
    } else {
      selectedItems.value = [];
      await loadPaperItems();
      mode.value = 'view';
    }
  } catch {
    /* 拦截器已提示 */
  } finally {
    adding.value = false;
  }
}
</script>

<template>
  <el-drawer
    :model-value="paperVisible"
    :title="`试卷 · ${state.name}（共 ${paperTotal} 题）`"
    direction="rtl"
    :size="drawerSize"
    :show-close="false"
    @update:model-value="(v: boolean) => !v && close()"
    @close="close"
    destroy-on-close
  >
    <div class="pw-wrap">
      <!-- 浏览态 -->
      <div v-if="mode === 'view'" v-loading="paperLoading" class="pw">
        <template v-if="paperItems.length">
          <div v-for="g in paperGroups" :key="g.key" class="pw__pg">
            <div class="pw__pg-title">{{ g.title }}<span class="pw__pg-count">（{{ g.items.length }} 题）</span></div>
            <div v-for="it in g.items" :key="it.id" class="pw__pq" @click="goDetail(it)">
              <span class="pw__pq-no">{{ (it as any).number ?? '' }}</span>
              <span class="pw__pq-stem"><MathText :value="it.stem" /></span>
              <el-tag size="small" effect="plain">{{ (QUESTION_TYPE_LABEL as any)[it.type] || it.type }}</el-tag>
              <el-button text type="primary" size="small" @click.stop="goDetail(it)">查看</el-button>
            </div>
          </div>
        </template>
        <el-empty v-else-if="!paperLoading" description="该文件暂无已入库题目" :image-size="60" />
        <div v-if="paperTotal > paperPageSize" class="pw__pager">
          <el-pagination
            v-model:current-page="paperPage"
            :total="paperTotal"
            :page-size="paperPageSize"
            layout="prev, pager, next"
            background
            @current-change="loadPaperItems"
          />
        </div>
      </div>

      <!-- 编辑态（内联，无独立弹窗） -->
      <div v-else-if="mode === 'edit'" v-loading="paperLoading" class="pw pe-mode">
        <div class="pe">
          <div class="pe__row">
            <span class="pe__label">试卷名称</span>
            <el-input v-model="editName" size="small" placeholder="试卷名称（同步更新题目来源）" style="width: 420px" />
          </div>
          <div class="pe__tip">拖动题号 ⋮⋮ = 换大题 / 组内重排（被拖题跟随指针，落点虚线占位、其他题自动避让）；拖动大题组 ⋮⋮ 手柄 = 大题排序。保存后全卷题号自动重排 1-2-3。</div>
          <TransitionGroup name="pe" tag="div" class="pe__groups">
            <template v-for="entry in displayGroups()" :key="entry.key">
              <div v-if="entry.kind === 'ph'" class="pe__ph pe__ph--group"><span>放到这里</span></div>
              <div
                v-else
                class="pe__group"
                :data-gi="entry.gi"
                :class="{ 'pe__group--over': itemDrag && itemDrag.overGroupIdx === entry.gi }"
              >
                <div class="pe__group-head">
                  <span class="pe__group-grip" title="拖动排序大题组" @pointerdown="onGroupDown($event, entry.gi)">⋮⋮</span>
                  <span class="pe__group-idx">第 {{ entry.gi + 1 }} 组</span>
                  <el-input v-model="entry.g.title" size="small" placeholder="大题标题，如 一、选择题" style="width: 240px" />
                  <span class="pe__group-count">{{ entry.g.items.length }} 题</span>
                  <el-button text type="danger" size="small" @click="onDeleteGroup(entry.g)">删组</el-button>
                </div>
                <div v-if="!entry.g.items.length && !(itemDrag && itemDrag.overGroupIdx === entry.gi)" class="pe__group-empty">（空组，把题号拖到此处即可归组）</div>
                <TransitionGroup name="pe" tag="div" class="pe__items">
                  <template v-for="it in displayList(entry.gi)" :key="it.key">
                    <div v-if="it.kind === 'ph'" class="pe__ph"><span>放到这里</span></div>
                    <div v-else class="pe__item" :data-id="it.it.id">
                      <span class="pe__item-no">{{ editNumberMap[it.it.id] }}</span>
                      <span class="pe__item-grip" title="拖动改归属大题组 / 组内重排" @pointerdown="onItemDown($event, it.it)">⋮⋮</span>
                      <span class="pe__item-stem"><MathText :value="it.it.stem" /></span>
                      <span class="pe__item-del" title="从本卷移除该题" @click="removeItem(it.it)">×</span>
                    </div>
                  </template>
                </TransitionGroup>
              </div>
            </template>
          </TransitionGroup>
        </div>
        <!-- 被拖模块：渲染「原组件」跟随指针（尺寸与真实组件一致，落点处占位缺口等高，避让不跳） -->
        <div
          v-if="itemDrag"
          class="pe__item pe__ghost pe__ghost--item"
          :style="{ left: itemDrag.x + 'px', top: itemDrag.y + 'px' }"
        >
          <span class="pe__item-no">{{ editNumberMap[itemDrag.id] }}</span>
          <span class="pe__item-grip">⋮⋮</span>
          <span class="pe__item-stem"><MathText :value="itemDrag.item.stem" /></span>
        </div>
        <div
          v-else-if="groupDrag"
          class="pe__group-head pe__ghost pe__ghost--group"
          :style="{ left: groupDrag.x + 'px', top: groupDrag.y + 'px' }"
        >
          <span class="pe__group-grip">⋮⋮</span>
          <span class="pe__group-idx">第 {{ groupDrag.from + 1 }} 组</span>
          <span class="pe__ghost-title">{{ groupDrag.title }}</span>
        </div>
      </div>

      <!-- 添加题目到试卷态：左本卷预览 + 右题库勾选 -->
      <div v-else-if="mode === 'add'" class="pw add-mode">
        <div class="add-col add-preview">
          <div class="add-preview__title">本卷预览（{{ paperTotal }} 题）</div>
          <div class="add-preview__body">
            <template v-if="paperItems.length">
              <div v-for="g in paperGroups" :key="g.key" class="pw__pg">
                <div class="pw__pg-title">{{ g.title }}<span class="pw__pg-count">（{{ g.items.length }} 题）</span></div>
                <div v-for="it in g.items" :key="it.id" class="pw__pq" @click="goDetail(it)">
                  <span class="pw__pq-no">{{ (it as any).number ?? '' }}</span>
                  <span class="pw__pq-stem"><MathText :value="it.stem" /></span>
                  <el-tag size="small" effect="plain">{{ (QUESTION_TYPE_LABEL as any)[it.type] || it.type }}</el-tag>
                </div>
              </div>
            </template>
            <el-empty v-else description="本卷暂无题目" :image-size="48" />
          </div>
        </div>
        <div class="add-col add-bank">
          <div class="add-bank__bar">
            <el-input v-model="bankQuery.search" size="small" placeholder="搜索题干关键词" clearable style="flex:1" @keyup.enter="onBankFilterChange" />
            <el-select v-model="bankQuery.subjectId" size="small" placeholder="学科" clearable style="width: 130px" @change="onBankFilterChange">
              <el-option v-for="s in subjectOptions" :key="s.id" :label="s.name" :value="s.id" />
            </el-select>
            <el-select v-model="bankQuery.type" size="small" placeholder="题型" clearable style="width: 120px" @change="onBankFilterChange">
              <el-option v-for="t in typeOptions" :key="t.value" :label="t.label" :value="t.value" />
            </el-select>
            <el-button size="small" :icon="'Search'" @click="onBankFilterChange">查</el-button>
          </div>
          <div v-loading="bankLoading" class="add-bank__list">
            <div
              v-for="it in bankItems"
              :key="it.id"
              class="add-bank__row"
              :class="{ 'add-bank__row--on': isSelected(it.id), 'add-bank__row--in': isInPaper(it) }"
              @click="toggleSelect(it)"
            >
              <el-checkbox
                :model-value="isSelected(it.id)"
                :disabled="isInPaper(it)"
                @click.stop
                @change="toggleSelect(it)"
              />
              <span class="add-bank__no">{{ isInPaper(it) ? ((it as any).number ?? '—') : '—' }}</span>
              <span class="add-bank__stem"><MathText :value="it.stem" /></span>
              <el-tag size="small" effect="plain">{{ (QUESTION_TYPE_LABEL as any)[it.type] || it.type }}</el-tag>
              <span v-if="isInPaper(it)" class="add-bank__in-tag">已在卷内</span>
            </div>
            <el-empty v-if="!bankLoading && !bankItems.length" description="未找到题目" :image-size="48" />
          </div>
          <div class="add-bank__pager">
            <el-pagination
              v-model:current-page="bankPage"
              :total="bankTotal"
              :page-size="bankPageSize"
              layout="prev, pager, next"
              small
              background
              @current-change="loadBank"
            />
          </div>
        </div>
      </div>

      <!-- 底部操作栏：随模式切换 -->
      <div class="pw__footer">
        <template v-if="mode === 'view'">
          <el-button v-if="state.type === 'paper' && state.jobId" type="primary" :icon="'Edit'" @click="enterEdit">
            编辑试卷
          </el-button>
          <el-button @click="close">关闭</el-button>
        </template>
        <template v-else-if="mode === 'edit'">
          <el-button @click="enterAddFromEdit">添加题目到试卷</el-button>
          <el-button @click="addGroup">添加大题组</el-button>
          <span class="pw__footer-spacer" />
          <el-button @click="mode = 'view'">取消</el-button>
          <el-button type="primary" :loading="editSaving" @click="saveEdit">保存</el-button>
        </template>
        <template v-else-if="mode === 'add'">
          <el-button @click="cancelAdd">取消</el-button>
          <el-button type="primary" :disabled="!selectedItems.length" :loading="adding" @click="confirmAdd">
            确认添加（{{ selectedItems.length }}）
          </el-button>
        </template>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.pw-wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.pw { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: var(--space-4); }
.pw__pg { display: flex; flex-direction: column; gap: 6px; }
.pw__pg-title { font-size: 14px; font-weight: 700; padding: 6px 0; border-bottom: 2px solid var(--c-primary); color: var(--c-text); }
.pw__pg-count { font-size: 12px; font-weight: 400; color: var(--c-text-subtle); margin-left: 6px; }
.pw__pq {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  border: 1px solid var(--c-border); border-radius: 6px; cursor: pointer;
  transition: border-color .15s, background .15s;
}
.pw__pq:hover { border-color: var(--c-primary); background: var(--c-bg-soft); }
.pw__pq-no { flex: 0 0 auto; font-weight: 700; color: var(--c-primary); min-width: 18px; text-align: right; }
.pw__pq-stem { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--c-text); }
.pw__pager { display: flex; justify-content: flex-end; }
.pw__footer { flex: 0 0 auto; display: flex; justify-content: flex-end; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--c-border); }
.pw__footer-spacer { flex: 1 1 auto; }

/* 编辑试卷（内联） */
.pe { display: flex; flex-direction: column; gap: var(--space-3); }
.pe__row { display: flex; align-items: center; gap: var(--space-2); }
.pe__label { font-size: 13px; font-weight: 600; color: var(--c-text-muted); }
.pe__tip { font-size: 12px; color: var(--c-text-subtle); }
.pe__group { border: 1px dashed var(--c-border); border-radius: 6px; padding: var(--space-2); display: flex; flex-direction: column; gap: 6px; }
.pe__group-head { display: flex; align-items: center; gap: var(--space-2); }
.pe__group-idx { font-size: 12px; font-weight: 700; color: var(--c-primary); }
.pe__group-count { font-size: 12px; color: var(--c-text-subtle); }
.pe__item { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border: 1px solid var(--c-border); border-radius: 4px; background: var(--c-bg-soft, #f5f7fa); }
.pe__item-no { flex: 0 0 auto; font-weight: 700; color: var(--c-primary); min-width: 18px; text-align: right; }
.pe__item-stem { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--c-text); }
.pe__item-del { flex: 0 0 auto; cursor: pointer; color: var(--c-text-subtle); font-size: 16px; line-height: 1; padding: 0 4px; border-radius: 3px; user-select: none; transition: color .15s, background .15s; }
.pe__item-del:hover { color: #fff; background: var(--c-danger, #f56c6c); }
/* 拖拽手柄（小题 / 大题组共用） */
.pe__item-grip, .pe__group-grip {
  flex: 0 0 auto; cursor: grab; color: var(--c-text-subtle); font-weight: 700; letter-spacing: -2px;
  user-select: none; touch-action: none; padding: 0 2px; border-radius: 3px;
}
.pe__item-grip:hover, .pe__group-grip:hover { color: var(--c-primary); background: rgba(79, 110, 247, 0.12); }
.pe__group-grip { font-size: 13px; }
.pe__groups { display: flex; flex-direction: column; gap: var(--space-3); }
.pe__items { display: flex; flex-direction: column; gap: 6px; }
.pe__group--over { border-color: var(--c-primary); background: rgba(79, 110, 247, 0.06); }
.pe__group-empty { font-size: 11px; color: var(--c-text-subtle); padding: 4px 10px; font-style: italic; }
/* 拖拽占位（其他模块让出的虚线缺口） */
.pe__ph {
  display: flex; align-items: center; justify-content: center; min-height: 30px;
  border: 1px dashed var(--c-primary); border-radius: 4px; background: rgba(79, 110, 247, 0.08);
  color: var(--c-primary); font-size: 11px;
}
.pe__ph--group { min-height: 42px; }
/* 列表重排动画（避让效果，FLIP） */
.pe-move, .pe-enter-active, .pe-leave-active { transition: transform .18s ease, opacity .18s ease; }
.pe-enter-from, .pe-leave-to { opacity: 0; }
/* 被拖模块：复用原组件外观（.pe__item / .pe__group-head），此处只负责「跟随指针 + 抬升」 */
.pe__ghost {
  position: fixed; z-index: 3000; pointer-events: none;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28); border-color: var(--c-primary) !important;
  transform: translate(12px, 12px); opacity: .98;
}
.pe__ghost--group { width: 360px; }
.pe__ghost-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; color: var(--c-text); }

/* 添加题目到试卷：左本卷预览 + 右题库勾选 */
.add-mode { flex-direction: row; gap: 12px; overflow: hidden; }
.add-col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; overflow: hidden; }
.add-preview { border-right: 1px solid var(--c-border); padding-right: 12px; }
.add-bank__bar { display: flex; gap: 6px; align-items: center; flex: 0 0 auto; }
.add-bank__list { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.add-bank__row {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px;
  border: 1px solid var(--c-border); border-radius: 6px; cursor: pointer; background: var(--c-bg, #fff);
  transition: border-color .15s, background .15s;
}
.add-bank__row:hover { border-color: var(--c-primary); }
.add-bank__row--on { border-color: var(--c-primary); background: var(--c-bg-soft); }
.add-bank__row--in { opacity: .55; cursor: not-allowed; }
.add-bank__no { flex: 0 0 auto; font-weight: 700; color: var(--c-primary); min-width: 18px; text-align: right; }
.add-bank__stem { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--c-text); }
.add-bank__in-tag { flex: 0 0 auto; font-size: 11px; color: var(--c-text-subtle); }
.add-bank__pager { flex: 0 0 auto; display: flex; justify-content: flex-end; }
.add-preview__title { flex: 0 0 auto; font-size: 13px; font-weight: 700; color: var(--c-text); padding-bottom: 4px; border-bottom: 1px solid var(--c-border); }
.add-preview__body { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: var(--space-4); }
</style>
