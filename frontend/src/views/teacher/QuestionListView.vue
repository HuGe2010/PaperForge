<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { questionsApi } from '../../api/questions';
import { subjectsApi } from '../../api/subjects';
import { tagsApi } from '../../api/tags';
import { ingestApi } from '../../api/ingest';
import { workbookApi } from '../../api/workbook';
import { usePaperWindow } from '../../composables/usePaperWindow';
import { useBreakpoint } from '../../composables/useBreakpoint';
import {
  QUESTION_TYPE_LABEL,
  QUESTION_TYPE_OPTIONS,
  SUBJECT_TREE_PROPS,
  type QuestionType,
  type QuestionStatus,
  type SourceType,
  type QuestionListItem,
  type Subject,
  type Tag,
  type QuestionQuery,
  type Workbook,
} from '../../types/models';
import ResponsiveTable, { type TableColumn } from '../../components/base/ResponsiveTable.vue';
import FilterChips, { type FilterItem } from '../../components/base/FilterChips.vue';
import EmptyState from '../../components/base/EmptyState.vue';
import SplitPane from '../../components/base/SplitPane.vue';
import MathText from '../../components/base/MathText.vue';
import QuestionFormDrawer from '../../components/biz/QuestionFormDrawer.vue';
import QuestionFilterSidebar from '../../components/biz/QuestionFilterSidebar.vue';
import QuestionCardGrid from '../../components/biz/QuestionCardGrid.vue';
import FileCardGrid from '../../components/biz/FileCardGrid.vue';

const router = useRouter();
const route = useRoute();
const { ltLg, isMobile } = useBreakpoint();
const { open: openPaperWindow } = usePaperWindow();

const loading = ref(false);
const data = ref<QuestionListItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const viewMode = ref<'table' | 'card'>('table');
const filterDrawer = ref(false);
const formDrawer = ref(false);
const editing = ref<QuestionListItem | null>(null);

const query = reactive<QuestionQuery>({});

// 四分类 Tab
const activeTab = ref<'question' | 'workbook' | 'paper' | 'compose'>('question');
const files = ref<{ id: string; name: string; subjectId: string | null; count: number; pageId: string | null }[]>([]);
const workbooks = ref<Workbook[]>([]);
const filesLoading = ref(false);

async function loadFiles() {
  if (activeTab.value !== 'workbook' && activeTab.value !== 'paper') return;
  filesLoading.value = true;
  try {
    if (activeTab.value === 'workbook') {
      // 作业本为独立实体：直接列 Workbook（含题目数 / 章节数）
      workbooks.value = (await workbookApi.list()) as unknown as Workbook[];
      files.value = [];
    } else {
      files.value = (await ingestApi.listFiles('PAPER')) as unknown as any[];
      workbooks.value = [];
    }
  } catch {
    /* 拦截器已提示 */
  } finally {
    filesLoading.value = false;
  }
}
function onTabChange() {
  if (activeTab.value === 'compose') {
    router.push('/teacher/compose');
    return;
  }
  loadFiles();
}

const subjects = ref<Subject[]>([]);
const tags = ref<Tag[]>([]);

const subjectNameMap = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  const walk = (list: Subject[]) => {
    for (const s of list) {
      map[s.id] = s.name;
      if (s.children) walk(s.children);
    }
  };
  walk(subjects.value);
  return map;
});

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

const columns: TableColumn[] = [
  { prop: 'stem', label: '题干', minWidth: 280, slot: 'stem' },
  { prop: 'typeLabel', label: '题型', width: 100 },
  { prop: 'difficulty', label: '难度', width: 110, slot: 'difficulty' },
  { prop: 'subjectName', label: '学科', width: 120 },
  { prop: 'tagNames', label: '标签', minWidth: 140, slot: 'tags' },
  { prop: 'status', label: '状态', width: 90, slot: 'status' },
  { prop: 'actions', label: '操作', width: 200, slot: 'actions', hideOnCard: true },
];

const activeFilters = computed<FilterItem[]>(() => {
  const out: FilterItem[] = [];
  if (query.search) out.push({ key: 'search', label: '关键词', value: query.search });
  if (query.subjectIds) {
    const ids = query.subjectIds.split(',').filter(Boolean);
    const name = subjectNameMap.value[ids[0]] || '学科';
    const extra = ids.length > 1 ? `（含${ids.length - 1}）` : '';
    out.push({ key: 'subjectIds', label: '学科', value: name + extra });
  }
  if (query.type) out.push({ key: 'type', label: '题型', value: QUESTION_TYPE_LABEL[query.type] });
  if (query.difficulty) out.push({ key: 'difficulty', label: '难度', value: `${query.difficulty} 星` });
  if (query.status) out.push({ key: 'status', label: '状态', value: STATUS_OPTIONS.find((s) => s.value === query.status)?.label || query.status });
  if (query.sourceType) out.push({ key: 'sourceType', label: '来源', value: SOURCE_OPTIONS.find((s) => s.value === query.sourceType)?.label || query.sourceType });
  if (query.tagId) out.push({ key: 'tagId', label: '标签', value: tags.value.find((t) => t.id === query.tagId)?.name || '标签' });
  return out;
});

function rowLabel(row: QuestionListItem, prop: string): string {
  switch (prop) {
    case 'typeLabel': return QUESTION_TYPE_LABEL[row.type];
    case 'subjectName': return row.subject?.name || '—';
    case 'tagNames': return row.tags.map((t) => t.name).join('、') || '—';
    default: return (row as any)[prop];
  }
}

async function load() {
  loading.value = true;
  try {
    const res = await questionsApi.list({ ...query, page: page.value, pageSize: pageSize.value });
    data.value = res.items;
    total.value = res.total;
  } catch {
    /* 拦截器已提示 */
  } finally {
    loading.value = false;
  }
}

function onFilterChange() {
  page.value = 1;
  load();
}

function removeFilter(key: string) {
  if (key === 'search') query.search = undefined;
  else (query as Record<string, unknown>)[key] = undefined;
  onFilterChange();
}
function clearFilters() {
  Object.keys(query).forEach((k) => ((query as Record<string, unknown>)[k] = undefined));
  onFilterChange();
}

function openCreate() {
  editing.value = null;
  formDrawer.value = true;
}
function goDetail(row: QuestionListItem) {
  router.push(`/teacher/questions/${row.id}`);
}
async function onDelete(row: QuestionListItem) {
  try {
    await ElMessageBox.confirm(`确认删除题目「${row.stem.slice(0, 20)}…」？`, '确认删除', { type: 'warning' });
    await questionsApi.remove(row.id);
    ElMessage.success('已删除');
    load();
  } catch {
    /* cancel */
  }
}

function onSaved() {
  load();
}

// 「按试卷/作业本」窗口：点击卡片/名称进入（可关闭可返回，全局组件 PaperWindow / WorkbookWindow）
function openFileWindow(row: { id: string; name: string }, type: 'paper' | 'workbook') {
  openPaperWindow(type, row.name, row.id);
}

// 新建作业本（作业本 tab 内联表单）
const creatingWb = ref(false);
const newWbName = ref('');
const newWbSubjectId = ref<string>();
const newWbDesc = ref('');
const creatingWbSaving = ref(false);
async function createWorkbook() {
  const name = newWbName.value.trim();
  if (!name) return ElMessage.warning('请输入作业本名称');
  creatingWbSaving.value = true;
  try {
    await workbookApi.create({ name, subjectId: newWbSubjectId.value || undefined, description: newWbDesc.value || undefined });
    ElMessage.success('作业本已创建');
    creatingWb.value = false;
    newWbName.value = '';
    newWbSubjectId.value = undefined;
    newWbDesc.value = '';
    await loadFiles();
  } catch {
    /* 拦截器已提示 */
  } finally {
    creatingWbSaving.value = false;
  }
}

async function removeWorkbook(wb: Workbook) {
  try {
    await workbookApi.remove(wb.id);
    ElMessage.success(`已删除「${wb.name}」`);
    await loadFiles();
  } catch {
    /* 拦截器已提示 */
  }
}
function viewOriginal(row: { pageId: string | null }) {
  if (!row.pageId) return ElMessage.warning('暂无原卷可查看');
  window.open(`/teacher/ingest`, '_blank');
}

onMounted(async () => {
  try {
    const [s, t] = await Promise.all([subjectsApi.tree(), tagsApi.list()]);
    subjects.value = s as unknown as Subject[];
    tags.value = t as unknown as Tag[];
  } catch {
    /* ignore */
  }
  // 来源试卷/来源文件过滤（从题目详情「来源试卷」「作业本」点击进入）
  const sp = route.query.sourcePaper;
  if (typeof sp === 'string' && sp) query.sourcePaper = sp;
  const sf = route.query.sourceFileId;
  if (typeof sf === 'string' && sf) query.sourceFileId = sf;
  load();
});

const statusType = (s: QuestionStatus) => (s === 'PUBLISHED' ? 'success' : s === 'DRAFT' ? 'info' : 'warning');

// ============ 批量删除 ============
const tableRef = ref<InstanceType<typeof ResponsiveTable> | null>(null);
const selectedRows = ref<QuestionListItem[]>([]);
const batchDeleting = ref(false);

function onSelectionChange(rows: Record<string, any>[]) {
  selectedRows.value = rows as QuestionListItem[];
}
function clearSelection() {
  selectedRows.value = [];
  tableRef.value?.clearSelection();
}
async function onBatchDelete() {
  const ids = selectedRows.value.map((r) => r.id);
  if (!ids.length) return;
  try {
    await ElMessageBox.confirm(
      `确认批量删除选中的 ${ids.length} 道题目？其中已被考试作答引用的题目会自动跳过。`,
      '批量删除',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  batchDeleting.value = true;
  try {
    const res = await questionsApi.batchRemove(ids);
    let msg = `成功删除 ${res.deleted} 道题目`;
    if (res.protected.length) msg += `，${res.protected.length} 道因已被考试作答而受保护、未删除`;
    ElMessage.success(msg);
    clearSelection();
    load();
  } catch {
    /* 拦截器已提示 */
  } finally {
    batchDeleting.value = false;
  }
}
</script>

<template>
  <div class="qb">
    <el-tabs v-model="activeTab" @tab-change="onTabChange" class="qb__tabs">
      <!-- ===================== 按题目：左树右表 ===================== -->
      <el-tab-pane label="按题目" name="question">
        <SplitPane v-if="!ltLg" direction="horizontal" :default-first="22" :min-first="18" :min-second="55" class="qb__split">
          <template #first>
            <QuestionFilterSidebar :query="query" :subjects="subjects" :tags="tags" @change="onFilterChange" />
          </template>
          <template #second>
            <div class="qb__list">
              <div class="qb__toolbar">
                <el-input
                  v-model="query.search"
                  placeholder="搜索题干"
                  clearable
                  style="width: 240px"
                  :prefix-icon="'Search'"
                  @keyup.enter="onFilterChange"
                  @clear="onFilterChange"
                />
                <el-radio-group v-model="viewMode" size="small" class="qb__viewtoggle">
                  <el-radio-button value="table" title="列表视图">
                    <el-icon><component :is="'List'" /></el-icon><span>列表</span>
                  </el-radio-button>
                  <el-radio-button value="card" title="卡片视图">
                    <el-icon><component :is="'Grid'" /></el-icon><span>卡片</span>
                  </el-radio-button>
                </el-radio-group>
                <div class="qb__spacer" />
                <el-button type="primary" :icon="'Plus'" @click="openCreate">新建题目</el-button>
                <template v-if="viewMode === 'table'">
                  <el-button type="danger" plain :icon="'Delete'" :disabled="!selectedRows.length" :loading="batchDeleting" @click="onBatchDelete">批量删除</el-button>
                  <template v-if="selectedRows.length">
                    <el-tag type="info" effect="plain">已选 {{ selectedRows.length }} 项</el-tag>
                    <el-button text :icon="'Close'" @click="clearSelection">取消选择</el-button>
                  </template>
                </template>
              </div>

              <FilterChips :filters="activeFilters" class="qb__chips" @remove="removeFilter" @clear="clearFilters" />

              <div class="qb__meta">
                <span class="qb__count">共 <strong>{{ total }}</strong> 道题</span>
                <span v-if="query.subjectIds || query.type || query.difficulty || query.status || query.sourceType || query.tagId || query.search" class="qb__count-tag">已筛选</span>
              </div>

              <div class="qb__result">
                <QuestionCardGrid v-if="isMobile || viewMode === 'card'" :data="data" :loading="loading" @open="goDetail" @delete="onDelete" />
                <ResponsiveTable
                  v-else
                  ref="tableRef"
                  :columns="columns"
                  :data="data"
                  row-key="id"
                  :loading="loading"
                  :selectable="true"
                  @selection-change="onSelectionChange"
                  card-title-key="stem"
                  empty-text="题库空空如也，点击「新建题目」开始录入"
                >
                  <template #difficulty="{ row }">
                    <el-rate :model-value="row.difficulty" disabled size="small" />
                  </template>
                  <template #stem="{ row }">
                    <div class="qb__stem" @click="goDetail(row as QuestionListItem)">
                      <MathText :value="row.stem" />
                    </div>
                  </template>
                  <template #tags="{ row }">
                    <el-tag v-for="t in row.tags" :key="t.id" size="small" effect="plain" class="qb__tag">{{ t.name }}</el-tag>
                    <span v-if="!row.tags.length" class="qb__muted">—</span>
                  </template>
                  <template #status="{ row }">
                    <el-tag :type="statusType(row.status)" size="small">{{ STATUS_OPTIONS.find((s) => s.value === row.status)?.label }}</el-tag>
                  </template>
                  <template #actions="{ row }">
                    <el-button text type="primary" size="small" @click="goDetail(row as QuestionListItem)">查看</el-button>
                    <el-button text type="primary" size="small" @click="goDetail(row as QuestionListItem)">编辑</el-button>
                    <el-button text type="danger" size="small" @click="onDelete(row as QuestionListItem)">删除</el-button>
                  </template>
                  <template #card-title="{ row }">
                    <div class="qb__stem" @click="goDetail(row as QuestionListItem)">
                      <MathText :value="row.stem" />
                    </div>
                  </template>
                  <template #card-actions="{ row }">
                    <el-button text type="primary" size="small" @click="goDetail(row as QuestionListItem)">查看</el-button>
                    <el-button text type="primary" size="small" @click="goDetail(row as QuestionListItem)">编辑</el-button>
                    <el-button text type="danger" size="small" @click="onDelete(row as QuestionListItem)">删除</el-button>
                  </template>
                </ResponsiveTable>
              </div>

              <div class="qb__pager">
                <el-pagination
                  v-model:current-page="page"
                  v-model:page-size="pageSize"
                  :total="total"
                  :page-sizes="[10, 20, 50, 100]"
                  layout="total, sizes, prev, pager, next"
                  background
                  @current-change="load"
                  @size-change="onFilterChange"
                />
              </div>
            </div>
          </template>
        </SplitPane>

        <!-- 窄屏：筛选降级为顶部按钮 + 抽屉 -->
        <div v-else class="qb__list">
          <div class="qb__toolbar">
            <el-button :icon="'Filter'" @click="filterDrawer = true">筛选</el-button>
            <el-input
              v-model="query.search"
              placeholder="搜索题干"
              clearable
              class="qb__search"
              :prefix-icon="'Search'"
              @keyup.enter="onFilterChange"
              @clear="onFilterChange"
            />
            <el-radio-group v-model="viewMode" size="small" class="qb__viewtoggle">
              <el-radio-button value="table" title="列表视图">
                <el-icon><component :is="'List'" /></el-icon><span>列表</span>
              </el-radio-button>
              <el-radio-button value="card" title="卡片视图">
                <el-icon><component :is="'Grid'" /></el-icon><span>卡片</span>
              </el-radio-button>
            </el-radio-group>
            <el-button type="primary" :icon="'Plus'" @click="openCreate">新建</el-button>
          </div>

          <FilterChips :filters="activeFilters" class="qb__chips" @remove="removeFilter" @clear="clearFilters" />

          <div class="qb__meta">
            <span class="qb__count">共 <strong>{{ total }}</strong> 道题</span>
            <span v-if="query.subjectIds || query.type || query.difficulty || query.status || query.sourceType || query.tagId || query.search" class="qb__count-tag">已筛选</span>
          </div>

          <div class="qb__result">
            <QuestionCardGrid :data="data" :loading="loading" @open="goDetail" @delete="onDelete" />
          </div>

          <div class="qb__pager">
            <el-pagination
              v-model:current-page="page"
              v-model:page-size="pageSize"
              :total="total"
              :page-sizes="[10, 20, 50, 100]"
              layout="total, sizes, prev, pager, next"
              background
              @current-change="load"
              @size-change="onFilterChange"
            />
          </div>
        </div>
      </el-tab-pane>

      <!-- ===================== 按作业本 ===================== -->
      <el-tab-pane label="按作业本" name="workbook">
        <div class="wb-tab">
          <div class="wb-tab__bar">
            <el-button type="primary" size="small" :icon="'Plus'" @click="creatingWb = true">新建作业本</el-button>
            <span class="wb-tab__hint">作业本为独立实体，章节树在打开后管理</span>
          </div>
          <div v-loading="filesLoading" class="wb-grid-wrap">
            <el-empty v-if="!workbooks.length && !filesLoading" description="暂无作业本，点击「新建作业本」" :image-size="64" />
            <div v-else class="wb-grid">
              <article
                v-for="wb in workbooks"
                :key="wb.id"
                class="wb-card"
                @click="openFileWindow(wb, 'workbook')"
              >
                <div class="wb-card__top">
                  <span class="wb-card__icon"><el-icon size="20"><Notebook /></el-icon></span>
                  <span class="wb-card__count">{{ wb.questionCount ?? 0 }} 题</span>
                </div>
                <h3 class="wb-card__name" :title="wb.name">{{ wb.name }}</h3>
                <div class="wb-card__meta">
                  <el-tag size="small" effect="plain" type="info">
                    {{ wb.subjectId ? (subjectNameMap[wb.subjectId] || '未知学科') : '未分类学科' }}
                  </el-tag>
                  <span class="wb-card__sec">{{ wb.sectionCount ?? 0 }} 章节</span>
                </div>
                <div class="wb-card__actions" @click.stop>
                  <el-button text type="primary" size="small" :icon="'View'" @click="openFileWindow(wb, 'workbook')">管理</el-button>
                  <el-popconfirm
                    title="删除作业本？题目将保留但不再归属该作业本"
                    confirm-button-text="删除"
                    cancel-button-text="取消"
                    @confirm="removeWorkbook(wb)"
                  >
                    <template #reference>
                      <el-button text type="danger" size="small" :icon="'Delete'" />
                    </template>
                  </el-popconfirm>
                </div>
              </article>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- ===================== 按试卷 ===================== -->
      <el-tab-pane label="按试卷" name="paper">
        <FileCardGrid
          :files="files"
          type="paper"
          :subject-name-map="subjectNameMap"
          :loading="filesLoading"
          @open="(row) => openFileWindow(row, 'paper')"
          @view-original="viewOriginal"
        />
      </el-tab-pane>

      <!-- ===================== 按组卷 ===================== -->
      <el-tab-pane label="按组卷" name="compose">
        <EmptyState
          icon="doc"
          title="组卷请前往「智能组卷」页面"
          description="在智能组卷中按知识点、难度、题型智能抽题并生成试卷。"
        >
          <template #action>
            <el-button type="primary" @click="router.push('/teacher/compose')">前往智能组卷</el-button>
          </template>
        </EmptyState>
      </el-tab-pane>
    </el-tabs>

    <!-- 窄屏筛选抽屉 -->
    <el-drawer v-model="filterDrawer" title="筛选" size="320px">
      <QuestionFilterSidebar :query="query" :subjects="subjects" :tags="tags" @change="onFilterChange" />
    </el-drawer>

    <!-- 新建作业本 -->
    <el-dialog v-model="creatingWb" title="新建作业本" width="440px" append-to-body>
      <el-form label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="newWbName" placeholder="如：高一数学暑假作业（一）" maxlength="80" @keyup.enter="createWorkbook" />
        </el-form-item>
        <el-form-item label="学科">
          <el-tree-select
            v-model="newWbSubjectId"
            :data="subjects"
            :props="SUBJECT_TREE_PROPS"
            check-strictly
            clearable
            placeholder="选填"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="newWbDesc" type="textarea" :rows="2" placeholder="选填" maxlength="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="creatingWb = false">取消</el-button>
        <el-button type="primary" :loading="creatingWbSaving" @click="createWorkbook">创建</el-button>
      </template>
    </el-dialog>

    <QuestionFormDrawer v-model="formDrawer" :question="editing ? editing as any : null" @saved="onSaved" />
  </div>
</template>

<style scoped>
.qb { display: flex; flex-direction: column; gap: var(--space-4); }
.qb__tabs { width: 100%; }
.qb__split { min-height: 420px; }

/* 右侧列表面板：与左侧筛选栏视觉一致 */
.qb__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  min-height: 100%;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  padding: var(--space-4);
}
.qb__toolbar { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.qb__search { flex: 1 1 160px; min-width: 160px; }
.qb__spacer { flex: 1 1 auto; }

/* 视图切换：清晰带文字的分段控件 */
.qb__viewtoggle :deep(.el-radio-button__inner) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.qb__viewtoggle .el-icon { font-size: 15px; }

.qb__chips { margin: 0; }

/* 结果计数条 */
.qb__meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 13px;
  color: var(--c-text-muted);
}
.qb__count strong { color: var(--c-text); font-weight: 700; }

/* 按作业本 tab */
.wb-tab { display: flex; flex-direction: column; gap: var(--space-3); }
.wb-tab__bar { display: flex; align-items: center; gap: var(--space-3); }
.wb-tab__hint { font-size: 12px; color: var(--c-text-subtle); }
.wb-grid-wrap { min-height: 200px; }
.wb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-4);
}
.wb-card {
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
.wb-card:hover {
  border-color: var(--c-primary);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}
.wb-card__top { display: flex; align-items: center; justify-content: space-between; }
.wb-card__icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border-radius: var(--radius-md);
  background: var(--c-primary-50, #eef2ff); color: var(--c-primary);
}
.wb-card__count { font-size: 12px; font-weight: 600; color: var(--c-text-muted); background: var(--c-surface-2); border-radius: var(--radius-pill); padding: 2px 10px; }
.wb-card__name { margin: 0; font-size: 15px; font-weight: 600; color: var(--c-text); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 42px; }
.wb-card__meta { display: flex; align-items: center; gap: var(--space-2); min-height: 24px; }
.wb-card__sec { font-size: 12px; color: var(--c-text-subtle); }
.wb-card__actions { display: flex; gap: var(--space-2); justify-content: flex-end; padding-top: var(--space-2); border-top: 1px solid var(--c-border); margin-top: auto; }

.qb__count-tag {
  font-size: 11px;
  color: var(--c-primary);
  background: var(--c-primary-50);
  border-radius: var(--radius-pill);
  padding: 1px 8px;
}

.qb__result { flex: 1 1 auto; min-height: 160px; }
.qb__stem { cursor: pointer; color: var(--c-text); transition: color .15s; }
.qb__stem:hover { color: var(--el-color-primary); }
.qb__tag { margin-right: 4px; }
.qb__muted { color: var(--c-text-subtle); }
.qb__pager { display: flex; justify-content: flex-end; }

/* 窄屏工具栏：筛选按钮 + 搜索占满 */
@media (max-width: 1023px) {
  .qb__toolbar .qb__search { order: 2; flex-basis: 100%; }
  .qb__list { min-height: 0; }
}
</style>
