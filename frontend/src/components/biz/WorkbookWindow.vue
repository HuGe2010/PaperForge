<script setup lang="ts">
import { ref, computed, watch, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { workbookApi, type WorkbookQuestion, type MoveSectionDirection } from '../../api/workbook';
import { questionsApi } from '../../api/questions';
import { subjectsApi } from '../../api/subjects';
import { usePaperWindow } from '../../composables/usePaperWindow';
import { QUESTION_TYPE_LABEL, type QuestionType, type Subject, type Workbook, type WorkbookSectionNode } from '../../types/models';
import MathText from '../base/MathText.vue';
import WbSectionTree from './WbSectionTree.vue';

const router = useRouter();
const { state, close } = usePaperWindow();

const visible = computed(() => state.visible && state.type === 'workbook');

// 抽屉宽度随模式变化（与试卷窗口一致：view 窄、edit 中、add 宽）
const drawerSize = computed(() => (mode.value === 'add' ? '72%' : mode.value === 'edit' ? '60%' : '52%'));

const wb = ref<(Workbook & { tree?: WorkbookSectionNode[]; rootQuestionCount?: number }) | null>(null);
const questions = ref<WorkbookQuestion[]>([]);
const selectedSectionId = ref<string | null>(null);
const loading = ref(false);

// 章节 id -> 全路径（名称数组，含作业本名），用于面包屑 / 分组标题
const sectionPathMap = computed<Record<string, string[]>>(() => {
  const map: Record<string, string[]> = {};
  const walk = (nodes: WorkbookSectionNode[], prefix: string[]) => {
    for (const n of nodes) {
      const path = [...prefix, n.name];
      map[n.id] = path;
      if (n.children?.length) walk(n.children, path);
    }
  };
  if (wb.value?.tree) walk(wb.value.tree, [wb.value.name]);
  return map;
});

// 章节 id -> 子树（含自身）id 集合，用于按章节过滤题目（含子孙）
const subtreeMap = computed<Record<string, Set<string>>>(() => {
  const map: Record<string, Set<string>> = {};
  const walk = (nodes: WorkbookSectionNode[]): Set<string> => {
    const acc = new Set<string>();
    for (const n of nodes) {
      const desc = n.children?.length ? walk(n.children) : new Set<string>();
      map[n.id] = new Set<string>([n.id, ...desc]);
      desc.forEach((d) => acc.add(d));
      acc.add(n.id);
    }
    return acc;
  };
  if (wb.value?.tree) walk(wb.value.tree);
  return map;
});

const selectedSectionPath = computed(() =>
  selectedSectionId.value && selectedSectionId.value !== '__root__' ? sectionPathMap.value[selectedSectionId.value] : null,
);

// 过滤：未选章节 -> 提示选择；选「作业本根」-> 未分章节题目；选章节 -> 该章节（含子孙）题目。
// 不再提供"全部题目"平铺页（避免跨章节题目混在一页）。归属改用外键 workbookSectionId，与名称路径无关。
const filteredQuestions = computed<WorkbookQuestion[]>(() => {
  if (!selectedSectionId.value) return []; // 未选章节：提示选择
  if (selectedSectionId.value === '__root__') {
    return questions.value.filter((q) => !q.workbookSectionId);
  }
  const set = subtreeMap.value[selectedSectionId.value];
  if (!set) return [];
  return questions.value.filter((q) => !!q.workbookSectionId && set.has(q.workbookSectionId));
});

// 右栏按章节路径分组（相对作业本名）
const groups = computed(() => {
  const map = new Map<string, WorkbookQuestion[]>();
  for (const q of filteredQuestions.value) {
    const rel = q.workbookSectionId
      ? sectionPathMap.value[q.workbookSectionId]?.slice(1).join(' / ') || '未知章节'
      : '作业本根';
    if (!map.has(rel)) map.set(rel, []);
    map.get(rel)!.push(q);
  }
  return Array.from(map.entries()).map(([title, items]) => ({ title, items }));
});

async function loadAll() {
  if (!state.workbookId) return;
  loading.value = true;
  try {
    const [w, qs] = await Promise.all([
      workbookApi.get(state.workbookId),
      workbookApi.listQuestions(state.workbookId),
    ]);
    wb.value = w;
    questions.value = qs;
    // 隐藏「作业本根」后，默认选中第一个章节；无章节则为 null（提示先新建）
    const first = w.tree && w.tree.length ? w.tree[0].id : null;
    if (!selectedSectionId.value || selectedSectionId.value === '__root__') {
      selectedSectionId.value = first;
    }
  } catch {
    /* 拦截器已提示 */
  } finally {
    loading.value = false;
  }
}

watch(
  () => visible.value,
  (v) => {
    if (v) {
      selectedSectionId.value = null;
      mode.value = 'view';
      loadAll();
    }
  },
);

function goDetail(id: string) {
  state.visible = false;
  router.push(`/teacher/questions/${id}`);
}

// ---------------- 章节编辑 ----------------
async function addRootSection() {
  if (!wb.value) return;
  try {
    const { value } = await ElMessageBox.prompt('输入章节名称', '新建章节', { inputValidator: (v) => (v && v.trim() ? true : '名称不能为空') });
    await workbookApi.createSection(wb.value.id, { name: value.trim() });
    ElMessage.success('已新建章节');
    await loadAll();
  } catch (e: any) {
    if (e !== 'cancel' && e?.action !== 'cancel') { /* 拦截器已提示 */ }
  }
}
async function addChild(id: string) {
  if (!wb.value) return;
  try {
    const { value } = await ElMessageBox.prompt('输入子章节名称', '新建子章节', { inputValidator: (v) => (v && v.trim() ? true : '名称不能为空') });
    await workbookApi.createSection(wb.value.id, { name: value.trim(), parentId: id });
    ElMessage.success('已新建子章节');
    await loadAll();
  } catch (e: any) {
    if (e !== 'cancel' && e?.action !== 'cancel') { /* 拦截器已提示 */ }
  }
}
async function renameSection(node: WorkbookSectionNode) {
  if (!wb.value) return;
  try {
    const { value } = await ElMessageBox.prompt('修改章节名称', '重命名', { inputValue: node.name, inputValidator: (v) => (v && v.trim() ? true : '名称不能为空') });
    await workbookApi.updateSection(wb.value.id, node.id, { name: value.trim() });
    ElMessage.success('已重命名');
    await loadAll();
  } catch (e: any) {
    if (e !== 'cancel' && e?.action !== 'cancel') { /* 拦截器已提示 */ }
  }
}
async function removeSection(node: WorkbookSectionNode) {
  if (!wb.value) return;
  try {
    await ElMessageBox.confirm(
      `删除章节「${node.name}」？其下题目将移出作业本、回到题库（题目不会删除）。`,
      '删除章节',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
    await workbookApi.removeSection(wb.value.id, node.id);
    ElMessage.success('已删除章节，题目已移出作业本');
    if (selectedSectionId.value === node.id || subtreeMap.value[node.id]?.has(selectedSectionId.value ?? '')) {
      selectedSectionId.value = '__root__';
    }
    await loadAll();
  } catch (e: any) {
    if (e !== 'cancel' && e?.action !== 'cancel') { /* 拦截器已提示 */ }
  }
}
async function moveSection(id: string, direction: MoveSectionDirection) {
  if (!wb.value) return;
  try {
    await workbookApi.moveSection(wb.value.id, id, { direction });
    await loadAll();
  } catch {
    /* 拦截器已提示 */
  }
}

// ---------------- 模式：view 浏览 / edit 编辑（管理章节）/ add 添加题目 ----------------
// 默认 view（只读展示）；点「管理章节」进入 edit 可管理章节树并添加题目；点「编辑属性」单独改作业本名称/学科/描述
const mode = ref<'view' | 'edit' | 'add'>('view');
const editable = computed(() => mode.value !== 'view');

// 添加目标是否合法：已选中任一节点（作业本根或任意层级章节）即可。
// 不再限制"仅最末级章节"——任意层级章节都能挂题，避免反直觉。
const canAddToTarget = computed(() => !!selectedSectionId.value);

// 底部操作栏按模式显示（用 boolean 计算属性，避免模板里直接比较 mode 被 vue-tsc 链式收窄报错）
const showViewFooter = computed(() => mode.value === 'view');
const showEditFooter = computed(() => mode.value === 'edit');
const showAddFooter = computed(() => mode.value === 'add');

const bankQuery = reactive({ search: '', subjectId: '', type: '' as QuestionType | '' });
const bankItems = ref<any[]>([]);
const bankTotal = ref(0);
const bankPage = ref(1);
const bankPageSize = ref(50);
const bankLoading = ref(false);
const selectedItems = ref<any[]>([]);
const adding = ref(false);
const subjectOptions = ref<{ id: string; name: string }[]>([]);
const typeOptions = Object.entries(QUESTION_TYPE_LABEL).map(([value, label]) => ({ value, label })) as { value: string; label: string }[];

const targetLabel = computed(() => {
  if (!selectedSectionId.value || selectedSectionId.value === '__root__') return `${wb.value?.name || '作业本'}根`;
  const path = sectionPathMap.value[selectedSectionId.value];
  return path ? path.slice(1).join(' / ') : '该章节';
});

function isSelected(id: string) {
  return selectedItems.value.some((x) => x.id === id);
}
/** 设定勾选（行点击与勾选框共用单一来源，杜绝重复切换导致"选了不生效"） */
function setSelected(it: any, v: boolean) {
  const i = selectedItems.value.findIndex((x) => x.id === it.id);
  if (v && i < 0) selectedItems.value.push(it);
  else if (!v && i >= 0) selectedItems.value.splice(i, 1);
}
/** 题目是否已属于本作业本（避免重复添加造成"不生效"的错觉） */
function alreadyInWb(it: any) {
  return !!wb.value && it.workbookId === wb.value.id;
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
function enterAdd() {
  if (!canAddToTarget.value) {
    ElMessage.warning('请先在左侧选择某个章节');
    return;
  }
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
async function confirmAdd() {
  if (!canAddToTarget.value) {
    ElMessage.warning('请选择章节后再添加题目');
    return;
  }
  if (!selectedItems.value.length) return;
  if (!wb.value) return;
  adding.value = true;
  try {
    const res = await workbookApi.assign(wb.value.id, {
      questionIds: selectedItems.value.map((x) => x.id),
      // '__root__' 哨兵代表作业本根，映射为 null（不加章节）；其余任意层级章节均可
      sectionId: selectedSectionId.value && selectedSectionId.value !== '__root__' ? selectedSectionId.value : null,
    });
    ElMessage.success(`已添加 ${res.assigned} 题到「${targetLabel.value}」`);
    selectedItems.value = [];
    mode.value = 'edit';
    await loadAll();
  } catch {
    /* 拦截器已提示 */
  } finally {
    adding.value = false;
  }
}

function cancelAdd() {
  selectedItems.value = [];
  mode.value = 'edit';
}
function enterEdit() {
  mode.value = 'edit';
}
function finishEdit() {
  mode.value = 'view';
}

// ---------------- 移出作业本 / 移动到其他章节 ----------------
const moveDialog = reactive({ visible: false, ids: [] as string[], target: '' as string, saving: false });
function openMove(it: WorkbookQuestion) {
  moveDialog.ids = [it.id];
  moveDialog.target = selectedSectionId.value && selectedSectionId.value !== '__root__' ? selectedSectionId.value : '';
  moveDialog.visible = true;
}
async function confirmMove() {
  if (!wb.value) return;
  if (!moveDialog.ids.length) return;
  const target = moveDialog.target || null; // 空 = 作业本根
  moveDialog.saving = true;
  try {
    await workbookApi.assign(wb.value.id, { questionIds: moveDialog.ids, sectionId: target });
    ElMessage.success('已移动题目');
    moveDialog.visible = false;
    await loadAll();
  } catch {
    /* 拦截器已提示 */
  } finally {
    moveDialog.saving = false;
  }
}
async function unassignOne(it: WorkbookQuestion) {
  if (!wb.value) return;
  try {
    await ElMessageBox.confirm('将该题移出作业本、回到题库（题目不删除）？', '移出作业本', { type: 'warning', confirmButtonText: '移出', cancelButtonText: '取消' });
  } catch {
    return;
  }
  try {
    const res = await workbookApi.unassign(wb.value.id, { questionIds: [it.id] });
    ElMessage.success(`已移出 ${res.unassigned} 题`);
    await loadAll();
  } catch {
    /* 拦截器已提示 */
  }
}

// ---------------- 编辑作业本属性（名称 / 学科 / 描述） ----------------
const attrDialog = reactive({ visible: false, name: '', subjectId: '' as string, description: '', saving: false });
function openAttrEdit() {
  if (!wb.value) return;
  loadSubjects();
  attrDialog.name = wb.value.name;
  attrDialog.subjectId = wb.value.subjectId ?? '';
  attrDialog.description = wb.value.description ?? '';
  attrDialog.visible = true;
}
async function saveAttr() {
  if (!wb.value) return;
  const name = attrDialog.name.trim();
  if (!name) return ElMessage.warning('名称不能为空');
  attrDialog.saving = true;
  try {
    await workbookApi.update(wb.value.id, {
      name,
      subjectId: attrDialog.subjectId || null,
      description: attrDialog.description,
    });
    ElMessage.success('已保存作业本属性');
    attrDialog.visible = false;
    await loadAll();
  } catch {
    /* 拦截器已提示 */
  } finally {
    attrDialog.saving = false;
  }
}

// 添加态左侧预览：用全量题目（按章节分组），准确反映本作业本已有题目
const allGroups = computed(() => {
  const map = new Map<string, WorkbookQuestion[]>();
  for (const q of questions.value) {
    const rel = q.workbookSectionId
      ? sectionPathMap.value[q.workbookSectionId]?.slice(1).join(' / ') || '未知章节'
      : '作业本根';
    if (!map.has(rel)) map.set(rel, []);
    map.get(rel)!.push(q);
  }
  return Array.from(map.entries()).map(([title, items]) => ({ title, items }));
});

// 移动对话框可选目标：作业本根 + 全部章节路径
const moveTargets = computed(() => {
  const out: { value: string; label: string }[] = [{ value: '', label: '作业本根（未分章节）' }];
  const walk = (nodes: WorkbookSectionNode[], prefix: string[]) => {
    for (const n of nodes) {
      const p = [...prefix, n.name];
      out.push({ value: n.id, label: p.slice(1).join(' / ') });
      if (n.children?.length) walk(n.children, p);
    }
  };
  if (wb.value?.tree) walk(wb.value.tree, [wb.value.name]);
  return out;
});
</script>

<template>
  <el-drawer
    :model-value="visible"
    :title="`作业本 · ${state.name}（共 ${questions.length} 题）`"
    direction="rtl"
    :size="drawerSize"
    :show-close="false"
    destroy-on-close
    @update:model-value="(v: boolean) => !v && close()"
    @close="close"
  >
    <div class="wbw">
      <!-- 左：章节树 -->
      <aside class="wbw__tree">
        <div class="wbw__tree-head">
          <span class="wbw__tree-title">章节</span>
          <el-button v-if="editable" text type="primary" size="small" :icon="'Plus'" @click="addRootSection">新建</el-button>
        </div>
        <div class="wbw__tree-body" v-loading="loading">
          <WbSectionTree
            v-if="wb?.tree?.length"
            :nodes="wb.tree"
            :selected-id="selectedSectionId"
            :editable="editable"
            @select="(id) => (selectedSectionId = id)"
            @add-child="addChild"
            @rename="renameSection"
            @remove="removeSection"
            @move="moveSection"
          />
          <el-empty v-else-if="!loading" description="暂无章节，点「新建」添加" :image-size="48" />
        </div>
      </aside>

      <!-- 右：题目区 -->
      <section class="wbw__main">
        <template v-if="mode === 'view' || mode === 'edit'">
          <div class="wbw__main-head">
            <div class="wbw__crumb">
              当前：<b>{{ selectedSectionId ? (selectedSectionId === '__root__' ? '作业本根' : (sectionPathMap[selectedSectionId]?.slice(1).join(' / ') || '该章节')) : '未选择章节' }}</b>
              <span class="wbw__crumb-count">（{{ filteredQuestions.length }} 题）</span>
            </div>
            <el-button v-if="mode === 'edit'" type="primary" size="small" :icon="'Plus'" @click="enterAdd">添加题目到作业本</el-button>
          </div>
          <div class="wbw__list" v-loading="loading">
            <el-empty v-if="!selectedSectionId" description="请选择左侧章节查看题目" :image-size="56" />
            <template v-else-if="groups.length">
              <div v-for="g in groups" :key="g.title" class="wbw__pg">
                <div class="wbw__pg-title">{{ g.title }}<span class="wbw__pg-count">（{{ g.items.length }} 题）</span></div>
                <div v-for="it in g.items" :key="it.id" class="wbw__q" @click="goDetail(it.id)">
                  <span class="wbw__q-stem"><MathText :value="it.stem" /></span>
                  <el-tag size="small" effect="plain">{{ (QUESTION_TYPE_LABEL as any)[it.type] || it.type }}</el-tag>
                  <el-button text type="primary" size="small" @click.stop="goDetail(it.id)">查看</el-button>
                  <el-button text type="warning" size="small" @click.stop="openMove(it)">移动</el-button>
                  <el-button text type="danger" size="small" @click.stop="unassignOne(it)">移出</el-button>
                </div>
              </div>
            </template>
            <el-empty v-else-if="!loading" description="该章节暂无题目，点「添加题目到作业本」" :image-size="56" />
          </div>
        </template>

        <!-- 添加题目到作业本：左本作业本预览 + 右题库勾选（须从编辑态进入，可添加到根或任意层级章节） -->
        <template v-if="mode === 'add'">
          <div class="wbw__main-head">
            <div class="wbw__crumb">将添加到：<b>{{ targetLabel }}</b></div>
            <el-tag v-if="!canAddToTarget" type="warning" size="small" effect="plain">请选择目标（作业本根或章节）</el-tag>
          </div>
          <div class="wbw__add">
            <div class="add-col add-preview">
              <div class="add-preview__title">本作业本预览（{{ questions.length }} 题）</div>
              <div class="add-preview__body">
                <template v-if="allGroups.length">
                  <div v-for="g in allGroups" :key="g.title" class="wbw__pg">
                    <div class="wbw__pg-title">{{ g.title }}<span class="wbw__pg-count">（{{ g.items.length }} 题）</span></div>
                    <div v-for="it in g.items" :key="it.id" class="wbw__q" @click="goDetail(it.id)">
                      <span class="wbw__q-stem"><MathText :value="it.stem" /></span>
                      <el-tag size="small" effect="plain">{{ (QUESTION_TYPE_LABEL as any)[it.type] || it.type }}</el-tag>
                    </div>
                  </div>
                </template>
                <el-empty v-else description="本作业本暂无题目" :image-size="48" />
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
                :class="{ 'add-bank__row--on': isSelected(it.id), 'add-bank__row--in': alreadyInWb(it) }"
                @click="!alreadyInWb(it) && setSelected(it, !isSelected(it.id))"
              >
                <el-checkbox
                  :model-value="isSelected(it.id)"
                  :disabled="alreadyInWb(it)"
                  @click.stop
                  @update:model-value="(v: any) => setSelected(it, !!v)"
                />
                <span class="add-bank__stem"><MathText :value="it.stem" /></span>
                <el-tag v-if="alreadyInWb(it)" size="small" type="success" effect="plain">已加入</el-tag>
                <el-tag v-else size="small" effect="plain">{{ (QUESTION_TYPE_LABEL as any)[it.type] || it.type }}</el-tag>
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
        </template>

        <!-- 底部操作栏：随模式切换（view 只读展示；edit 可管理章节/添加；add 确认入库） -->
        <div class="wbw__footer">
          <template v-if="showViewFooter">
            <el-button type="primary" :icon="'Edit'" @click="enterEdit">管理作业本</el-button>
            <el-button :icon="'Setting'" @click="openAttrEdit">编辑属性</el-button>
            <span class="wbw__footer-spacer" />
            <el-button @click="close">关闭</el-button>
          </template>
          <template v-else-if="showEditFooter">
            <span class="wbw__footer-spacer" />
            <el-button @click="finishEdit">完成</el-button>
          </template>
          <template v-else-if="showAddFooter">
            <el-button @click="cancelAdd">取消</el-button>
            <el-button type="primary" :disabled="!selectedItems.length || !canAddToTarget" :loading="adding" @click="confirmAdd">
              确认添加（{{ selectedItems.length }}）
            </el-button>
          </template>
        </div>
      </section>
    </div>

    <!-- 移动到其他章节 -->
    <el-dialog v-model="moveDialog.visible" title="移动到" width="420px" append-to-body>
      <el-form label-width="80px">
        <el-form-item label="目标章节">
          <el-select v-model="moveDialog.target" placeholder="选择目标（空=作业本根）" style="width: 100%" clearable>
            <el-option v-for="t in moveTargets" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="moveDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="moveDialog.saving" @click="confirmMove">确定移动</el-button>
      </template>
    </el-dialog>

    <!-- 编辑作业本属性 -->
    <el-dialog v-model="attrDialog.visible" title="编辑作业本属性" width="460px" append-to-body>
      <el-form label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="attrDialog.name" maxlength="120" @keyup.enter="saveAttr" />
        </el-form-item>
        <el-form-item label="学科">
          <el-tree-select
            v-model="attrDialog.subjectId"
            :data="subjectOptions"
            node-key="id"
            :props="{ label: 'name' }"
            check-strictly
            clearable
            placeholder="选填"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="attrDialog.description" type="textarea" :rows="3" maxlength="500" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="attrDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="attrDialog.saving" @click="saveAttr">保存</el-button>
      </template>
    </el-dialog>
  </el-drawer>
</template>

<style scoped>
.wbw { display: flex; height: 100%; min-height: 0; gap: var(--space-3); }
.wbw__tree { flex: 0 0 260px; display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--c-border); padding-right: var(--space-3); }
.wbw__tree-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: var(--space-2); }
.wbw__tree-title { font-size: 14px; font-weight: 700; color: var(--c-text); }
.wbw__tree-body { flex: 1 1 auto; min-height: 0; overflow: auto; }
.wbw__all { padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; color: var(--c-text); margin-bottom: 4px; transition: background var(--motion-base) var(--ease-out); }
.wbw__all:hover { background: var(--c-surface-2); }
.wbw__all.is-selected { background: var(--c-primary-50, #eef2ff); box-shadow: inset 2px 0 0 var(--c-primary); }

.wbw__main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.wbw__main-head { display: flex; align-items: center; gap: var(--space-3); padding-bottom: var(--space-2); border-bottom: 1px solid var(--c-border); }
.wbw__crumb { font-size: 13px; color: var(--c-text-muted); }
.wbw__crumb b { color: var(--c-primary); }
.wbw__crumb-count { color: var(--c-text-subtle); font-weight: 400; }
.wbw__spacer { flex: 1 1 auto; }
.wbw__list { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: var(--space-4); padding-top: var(--space-3); }
.wbw__pg { display: flex; flex-direction: column; gap: 6px; }
.wbw__pg-title { font-size: 14px; font-weight: 700; padding: 6px 0; border-bottom: 2px solid var(--c-primary); color: var(--c-text); }
.wbw__pg-count { font-size: 12px; font-weight: 400; color: var(--c-text-subtle); margin-left: 6px; }
.wbw__q { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--c-border); border-radius: 6px; cursor: pointer; transition: border-color .15s, background .15s; }
.wbw__q:hover { border-color: var(--c-primary); background: var(--c-bg-soft); }
.wbw__q-stem { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--c-text); }

.wbw__add { flex: 1 1 auto; min-height: 0; display: flex; gap: 12px; overflow: hidden; }
.add-col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; overflow: hidden; }
.add-preview { border-right: 1px solid var(--c-border); padding-right: 12px; }
.add-preview__title { flex: 0 0 auto; font-size: 13px; font-weight: 700; color: var(--c-text); padding-bottom: 4px; border-bottom: 1px solid var(--c-border); }
.add-preview__body { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: var(--space-4); }
.add-bank__bar { display: flex; gap: 6px; align-items: center; flex: 0 0 auto; }
.add-bank__list { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.add-bank__row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--c-border); border-radius: 6px; cursor: pointer; background: var(--c-bg, #fff); transition: border-color .15s, background .15s; }
.add-bank__row:hover { border-color: var(--c-primary); }
.add-bank__row--on { border-color: var(--c-primary); background: var(--c-bg-soft); }
.add-bank__stem { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--c-text); }
.add-bank__pager { flex: 0 0 auto; display: flex; justify-content: flex-end; }

/* 底部操作栏（随模式切换，与试卷窗口一致） */
.wbw__footer { flex: 0 0 auto; display: flex; align-items: center; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--c-border); margin-top: var(--space-2); }
.wbw__footer-spacer { flex: 1 1 auto; }
</style>
