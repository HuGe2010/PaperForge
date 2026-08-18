<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { papersApi } from '../../api/papers';
import { subjectsApi } from '../../api/subjects';
import {
  QUESTION_TYPE_LABEL,
  QUESTION_TYPE_OPTIONS,
  SUBJECT_TREE_PROPS,
  PAPER_STATUS_LABEL,
  type Subject,
  type Paper,
  type ComposeCandidate,
  type QuestionType,
} from '../../types/models';
import MathText from '../../components/base/MathText.vue';

const route = useRoute();
const subjects = ref<Subject[]>([]);

// ---------------- 组卷表单 ----------------
const form = reactive({ title: '', subjectId: undefined as string | undefined, estimatedMinutes: undefined as number | undefined, description: '' });
const composeParams = reactive({
  types: [] as QuestionType[],
  difficultyMin: undefined as number | undefined,
  difficultyMax: undefined as number | undefined,
  count: 10,
});

const candidates = ref<ComposeCandidate[]>([]);
const selectedRows = ref<any[]>([]);
const scores = reactive<Record<string, number>>({});
const composing = ref(false);
const saving = ref(false);

function isChoice(t: QuestionType) {
  return t === 'SINGLE_CHOICE' || t === 'MULTIPLE_CHOICE';
}

async function doCompose() {
  composing.value = true;
  try {
    candidates.value = (await papersApi.compose({ ...composeParams, subjectId: form.subjectId })) as unknown as ComposeCandidate[];
    selectedRows.value = [];
    Object.keys(scores).forEach((k) => delete scores[k]);
    // 默认全选
    selectedRows.value = candidates.value.slice();
    candidates.value.forEach((c) => (scores[c.id] = c.score));
    if (!candidates.value.length) ElMessage.info('未匹配到题目，请调整条件');
  } catch {
    /* 拦截器已提示 */
  } finally {
    composing.value = false;
  }
}

function onSelectChange(val: any[]) {
  selectedRows.value = val;
  val.forEach((r) => {
    if (scores[r.id] == null) scores[r.id] = r.score;
  });
}

async function savePaper() {
  if (!form.title.trim()) return ElMessage.warning('请填写试卷标题');
  if (!selectedRows.value.length) return ElMessage.warning('请至少选择一道题');
  saving.value = true;
  try {
    const paper = (await papersApi.create({
      title: form.title,
      subjectId: form.subjectId,
      estimatedMinutes: form.estimatedMinutes,
      description: form.description,
    })) as unknown as Paper;
    await papersApi.batchAdd(paper.id, {
      items: selectedRows.value.map((r) => ({ questionId: r.id, score: scores[r.id] ?? r.score })),
    });
    ElMessage.success('试卷已保存');
    form.title = '';
    form.description = '';
    candidates.value = [];
    selectedRows.value = [];
    Object.keys(scores).forEach((k) => delete scores[k]);
    loadPapers();
  } catch {
    /* 拦截器已提示 */
  } finally {
    saving.value = false;
  }
}

// ---------------- 我的试卷 ----------------
const papers = ref<Paper[]>([]);
const papersTotal = ref(0);
const previewDrawer = ref(false);
const previewPaper = ref<Paper | null>(null);

async function loadPapers() {
  try {
    const res = (await papersApi.list({ page: 1, pageSize: 50 })) as unknown as {
      items: Paper[];
      total: number;
    };
    papers.value = res.items;
    papersTotal.value = res.total;
  } catch {
    /* 拦截器已提示 */
  }
}

async function openPreview(p: Paper) {
  try {
    previewPaper.value = (await papersApi.get(p.id)) as unknown as Paper;
    previewDrawer.value = true;
  } catch {
    /* 拦截器已提示 */
  }
}

// 从题目详情「组卷引用」跳转进入：按 paperId 自动打开预览
async function openPreviewById(paperId: string) {
  try {
    previewPaper.value = (await papersApi.get(paperId)) as unknown as Paper;
    previewDrawer.value = true;
  } catch {
    /* 拦截器已提示 */
  }
}

async function removePaper(p: Paper) {
  try {
    await ElMessageBox.confirm(`删除试卷「${p.title}」？`, '确认', { type: 'warning' });
    await papersApi.remove(p.id);
    ElMessage.success('已删除');
    loadPapers();
  } catch {
    /* cancel */
  }
}

onMounted(async () => {
  try {
    subjects.value = (await subjectsApi.tree()) as unknown as Subject[];
  } catch {
    /* ignore */
  }
  await loadPapers();
  // 从题目详情「组卷引用」跳入：自动打开指定试卷预览
  const pid = route.query.paperId;
  if (typeof pid === 'string' && pid) await openPreviewById(pid);
});
</script>

<template>
  <div class="compose">
    <!-- 组卷区 -->
    <el-card shadow="never" class="compose__card">
      <template #header><span class="compose__title">智能组卷</span></template>
      <el-form label-position="top" class="compose__form">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="试卷标题" required>
              <el-input v-model="form.title" placeholder="如 高一数学期中模拟（一）" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="学科">
              <el-tree-select v-model="form.subjectId" :data="subjects" :props="SUBJECT_TREE_PROPS" check-strictly clearable placeholder="选填" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="预计时长（分钟）">
              <el-input-number v-model="form.estimatedMinutes" :min="1" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="抽题条件">
          <div class="compose__criteria">
            <el-select v-model="composeParams.types" multiple collapse-tags clearable placeholder="题型（空=不限）" style="width: 260px">
              <el-option v-for="o in QUESTION_TYPE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <el-select v-model="composeParams.difficultyMin" clearable placeholder="难度≥" style="width: 110px">
              <el-option v-for="d in [1,2,3,4,5]" :key="d" :label="`${d}★`" :value="d" />
            </el-select>
            <el-select v-model="composeParams.difficultyMax" clearable placeholder="难度≤" style="width: 110px">
              <el-option v-for="d in [1,2,3,4,5]" :key="d" :label="`${d}★`" :value="d" />
            </el-select>
            <el-input-number v-model="composeParams.count" :min="1" :max="100" controls-position="right" />
            <el-button type="primary" :loading="composing" @click="doCompose">智能抽题</el-button>
          </div>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 候选区 -->
    <el-card v-if="candidates.length" shadow="never" class="compose__card">
      <template #header>
        <div class="compose__head">
          <span>候选题目（{{ candidates.length }} 道，已选 {{ selectedRows.length }}）</span>
          <el-button type="success" :loading="saving" @click="savePaper">保存为试卷</el-button>
        </div>
      </template>
      <el-table :data="candidates" row-key="id" @selection-change="onSelectChange">
        <el-table-column type="selection" width="46" />
        <el-table-column label="题型" width="100">
          <template #default="{ row }">{{ QUESTION_TYPE_LABEL[(row as ComposeCandidate).type] }}</template>
        </el-table-column>
        <el-table-column label="题干" min-width="320">
          <template #default="{ row }"><MathText :value="(row as ComposeCandidate).stem" /></template>
        </el-table-column>
        <el-table-column label="难度" width="120">
          <template #default="{ row }"><el-rate :model-value="(row as ComposeCandidate).difficulty" disabled size="small" /></template>
        </el-table-column>
        <el-table-column label="分值" width="130">
          <template #default="{ row }">
            <el-input-number :model-value="scores[(row as ComposeCandidate).id]" :min="0" :step="1" size="small" @update:model-value="(v: number | undefined) => (scores[(row as ComposeCandidate).id] = v ?? 0)" />
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 我的试卷 -->
    <el-card shadow="never" class="compose__card">
      <template #header><span class="compose__title">我的试卷</span></template>
      <el-table :data="papers" stripe>
        <el-table-column prop="title" label="标题" min-width="200" />
        <el-table-column label="学科" width="120">
          <template #default="{ row }">{{ (row as Paper).subject?.name || '—' }}</template>
        </el-table-column>
        <el-table-column label="题数" width="80">
          <template #default="{ row }">{{ (row as Paper)._count?.questions ?? 0 }}</template>
        </el-table-column>
        <el-table-column prop="totalScore" label="总分" width="90" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><el-tag size="small">{{ PAPER_STATUS_LABEL[(row as Paper).status] }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button text type="primary" size="small" @click="openPreview(row as Paper)">预览</el-button>
            <el-button text type="danger" size="small" @click="removePaper(row as Paper)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>还没有试卷，先左侧智能组卷保存一份吧</template>
      </el-table>
    </el-card>

    <!-- 预览抽屉 -->
    <el-drawer v-model="previewDrawer" :title="`预览 · ${previewPaper?.title || ''}`" size="680px">
      <div v-if="previewPaper" class="pv">
        <div class="pv__meta">
          共 {{ previewPaper.questions?.length || 0 }} 题 · 总分 {{ previewPaper.totalScore }} 分
          <span v-if="previewPaper.estimatedMinutes"> · 约 {{ previewPaper.estimatedMinutes }} 分钟</span>
        </div>
        <div v-for="(pq, idx) in previewPaper.questions" :key="pq.id" class="pv__item">
          <div class="pv__head">
            <span class="pv__no">{{ idx + 1 }}.</span>
            <el-tag size="small">{{ QUESTION_TYPE_LABEL[pq.question!.type] }}</el-tag>
            <span class="pv__score">{{ pq.score }} 分</span>
          </div>
          <MathText :value="pq.question!.stem" />
          <div v-if="isChoice(pq.question!.type)" class="pv__opts">
            <div v-for="o in pq.snapshot?.options || []" :key="o.key" :class="{ 'pv__opt--correct': o.correct }">
              {{ o.key }}. <MathText :value="o.text" />
              <span v-if="o.correct" class="pv__check">✓</span>
            </div>
          </div>
          <div v-else-if="pq.question!.type === 'TRUE_FALSE'" class="pv__ans">
            答案：{{ pq.snapshot?.answer === 'true' ? '正确' : '错误' }}
          </div>
          <div v-else-if="pq.question!.type === 'FILL_BLANK'" class="pv__ans">
            参考答案：{{ (pq.snapshot?.blanks || []).join(' / ') }}
          </div>
          <div v-else-if="pq.question!.type === 'SHORT_ANSWER' || pq.question!.type === 'ESSAY'" class="pv__ans">
            评分要点：{{ pq.snapshot?.rubric }}
          </div>
          <div v-if="pq.question!.analysis" class="pv__analysis">
            <strong>解析：</strong><MathText :value="pq.question!.analysis" />
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.compose { display: flex; flex-direction: column; gap: var(--space-4); }
.compose__title { font-weight: 700; }
.compose__head { display: flex; justify-content: space-between; align-items: center; }
.compose__form :deep(.el-form-item) { margin-bottom: var(--space-2); }
.compose__criteria { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: center; }
.pv { display: flex; flex-direction: column; gap: var(--space-4); }
.pv__meta { color: var(--c-text-muted); font-size: 13px; }
.pv__item { border-bottom: 1px dashed var(--c-border); padding-bottom: var(--space-3); }
.pv__head { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-2); }
.pv__no { font-weight: 700; }
.pv__score { margin-left: auto; color: var(--c-text-muted); }
.pv__opts { display: flex; flex-direction: column; gap: 4px; margin: var(--space-2) 0; }
.pv__opt--correct { color: var(--c-success, #16a34a); font-weight: 600; }
.pv__check { margin-left: 4px; }
.pv__ans { margin: var(--space-2) 0; color: var(--c-text-muted); }
.pv__analysis { margin-top: var(--space-2); font-size: 13px; color: var(--c-text-muted); }
</style>
