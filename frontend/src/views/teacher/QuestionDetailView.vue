<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { questionsApi } from '../../api/questions';
import type { MergedQuestion } from '../../api/questions';
import { subjectsApi } from '../../api/subjects';
import { tagsApi } from '../../api/tags';
import { knowledgeApi } from '../../api/knowledge';
import {
  QUESTION_TYPE_LABEL,
  QUESTION_TYPE_OPTIONS,
  SUBJECT_TREE_PROPS,
  KP_TREE_PROPS,
  type Subject,
  type Tag,
  type KnowledgePoint,
  type QuestionType,
  type QuestionContent,
} from '../../types/models';
import MathText from '../../components/base/MathText.vue';
import QuestionContentView from '../../components/base/QuestionContentView.vue';
import SubQuestionsEditor from '../../components/base/SubQuestionsEditor.vue';
import OptionsEditor from '../../components/base/OptionsEditor.vue';
import QuestionImageEditor from '../../components/biz/QuestionImageEditor.vue';
import { subQuestionsToContent, optionsToAnswer, type SubQuestionEdit } from '../../types/subQuestion';
import { useBreakpoint } from '../../composables/useBreakpoint';
import { solvingQuestions } from '../../composables/solvingState';
import { usePaperWindow } from '../../composables/usePaperWindow';

const route = useRoute();
const router = useRouter();
const { ltMd } = useBreakpoint();
// 来源试卷 → 打开题库「按试卷」窗口（可关闭可返回）
const { open: openPaperWindow } = usePaperWindow();

const loading = ref(false);
const question = ref<any>(null);
const croppedUrl = ref('');
const editing = ref(false);

const subjects = ref<Subject[]>([]);
const tags = ref<Tag[]>([]);
const kpTrees = reactive<Record<string, KnowledgePoint[]>>({});

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: '草稿' },
  { value: 'PUBLISHED', label: '已发布' },
  { value: 'ARCHIVED', label: '归档' },
];

const form = reactive({
  type: '' as QuestionType | '',
  stem: '',
  difficulty: 3,
  analysis: '',
  status: 'PUBLISHED' as string,
  subjectId: '' as string | undefined,
  paperName: '',
  score: 0,
  tagIds: [] as string[],
  knowledgePointIds: [] as string[],
  options: [] as { key: string; text: string; correct?: boolean }[],
  subQuestions: [] as SubQuestionEdit[],
});
const saving = ref(false);

// 题图（content.images 中「非合并来源」的题图）：详情页可单独增删，保存走原子接口 PATCH /questions/:id/images
const images = ref<{ cropId: string; label?: string }[]>([]);
// 合并来源原图（查重合并时并入的其它题原图）：与「裁切原图」同款大图展示，并标注来源试卷（只读，不参与题图编辑）
const mergedImages = ref<{ cropId: string; label?: string; paper?: string; kind?: string }[]>([]);
// 合并来的题目（按合并记录实时反查）：每道含识别内容 + AI 解答，与左侧合并原图按 cropId 对应
const mergedQuestions = ref<MergedQuestion[]>([]);
function isMergedImage(im: any): boolean {
  return !!im && (im.kind === 'merged' || im.label === '试卷裁切原图');
}
const viewImages = computed(() =>
  ((question.value?.content?.images as any[]) || [])
    .filter((im: any) => im?.cropId && !isMergedImage(im)),
);
function syncImages() {
  const all = ((question.value?.content?.images as any[]) || []).filter((im: any) => im?.cropId);
  const figs = all.filter((im: any) => !isMergedImage(im));
  images.value = figs.map((im: any) => ({ cropId: im.cropId as string, label: im.label }));
  mergedImages.value = all
    .filter(isMergedImage)
    .map((im: any) => ({ cropId: im.cropId as string, label: im.label, paper: im.paper, kind: im.kind || 'merged' }));
}
/** 从来源图路径抽 cropId（与后端 cropIdFromPath 同规则：仅 crops/ 下的单题裁切图） */
function cropKeyOf(path?: string | null): string | null {
  if (!path || !/crops\//i.test(path)) return null;
  const base = path.split(/[\\/]/).pop() || '';
  const m = /^(.+)\.(png|jpe?g)$/i.exec(base);
  return m ? m[1] : null;
}
/** 某张合并原图对应的合并题（被合并题的 sourceImagePath 即其裁切原图，按 cropId 关联） */
function mergedQuestionOf(cropId: string): MergedQuestion | null {
  if (!cropId) return null;
  return mergedQuestions.value.find((m) => cropKeyOf(m.sourceImagePath) === cropId) || null;
}
/** 某道合并题是否有对应的合并原图（无则归入纯文字折叠块，内容不丢） */
function hasMergedImage(m: MergedQuestion): boolean {
  const key = cropKeyOf(m.sourceImagePath);
  return !!key && mergedImages.value.some((im) => im.cropId === key);
}
// 没有对应合并原图的合并题：在左栏末尾以纯文字折叠块展示
const mergedTextOnly = computed(() => mergedQuestions.value.filter((m) => !hasMergedImage(m)));
// 主保留题的所属试卷（用于给裁切原图标注重试卷）
const keptPaper = computed(() => {
  const q = question.value;
  if (!q) return '';
  return (Array.isArray(q.sourcePapers) && q.sourcePapers[0]) || q.sourcePaperName || '';
});

// 是否已生成过 AI 解答：用于切换按钮文案（生成 AI 解答 ↔ 重新生成答案）。
const hasSolution = computed(
  () => !!(question.value?.aiGenerated || question.value?.solution || question.value?.analysis),
);

// 当前题目是否正在后台生成解答（跨实例共享、按 id 记录）。
// 退出题目再进入时仍能读到「上次解答仍在进行」，从而禁止重复点击。
const qid = computed(() => question.value?.id as string | undefined);
const isSolving = computed(() => (qid.value ? !!solvingQuestions[qid.value] : false));

const isChoice = computed(
  () => form.type === 'SINGLE_CHOICE' || form.type === 'MULTIPLE_CHOICE' || form.type === 'TRUE_FALSE',
);

async function load() {
  loading.value = true;
  try {
    const q = (await questionsApi.get(route.params.id as string)) as any;
    question.value = q;
    // 初始化编辑表单
    form.type = q.type;
    form.stem = q.stem || '';
    form.difficulty = q.difficulty ?? 3;
    form.analysis = q.analysis || '';
    form.status = q.status || 'PUBLISHED';
    form.subjectId = q.subject?.id || undefined;
    form.paperName = (Array.isArray(q.sourcePapers) && q.sourcePapers[0]) || q.sourcePaperName || '';
    form.score = typeof q.content?.score === 'number' ? q.content.score : 0;
    form.tagIds = (q.tags || []).map((t: any) => t.id);
    form.knowledgePointIds = (q.knowledgePoints || []).map((k: any) => k.id);
    form.options = Array.isArray(q.content?.options) ? q.content.options.map((o: any) => ({ ...o })) : [];
    form.subQuestions = Array.isArray(q.content?.subQuestions)
      ? q.content.subQuestions.map((s: any) => ({
          type: s.type ?? '',
          stem: s.stem ?? '',
          options: (s.options || []).map((o: any) => ({ key: o.key, text: o.text ?? '', correct: o.correct })),
          answer: s.answer ?? '',
        }))
      : [];
    await loadCroppedImage();
    syncImages();
    // 合并来的题目（实时反查合并记录；无合并时为空数组）
    try {
      mergedQuestions.value = await questionsApi.mergedQuestions(q.id);
    } catch {
      mergedQuestions.value = [];
    }
  } catch {
    /* 拦截器已提示 */
  } finally {
    loading.value = false;
  }
}

async function loadCroppedImage() {
  croppedUrl.value = '';
  const q = question.value;
  if (!q?.sourceImagePath) return;
  try {
    const url = await questionsApi.sourceImageUrl(q.id);
    const bbox = q?.content?.sourceBbox;
    if (Array.isArray(bbox) && bbox.length === 4) {
      // 来源为整页图：按 bbox 裁出单题
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = url;
      });
      const [x0, y0, x1, y1] = bbox;
      const sx = x0 * img.naturalWidth;
      const sy = y0 * img.naturalHeight;
      const sw = (x1 - x0) * img.naturalWidth;
      const sh = (y1 - y0) * img.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sw));
      canvas.height = Math.max(1, Math.round(sh));
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      croppedUrl.value = canvas.toDataURL('image/png');
      URL.revokeObjectURL(url);
    } else {
      // 来源图已是单题裁切图（录入时按框裁出），直接展示，不二次裁切
      croppedUrl.value = url;
    }
  } catch {
    croppedUrl.value = '';
  }
}

async function ensureKpTree(subjectId: string) {
  if (!subjectId || kpTrees[subjectId]) return;
  try {
    kpTrees[subjectId] = (await knowledgeApi.tree(subjectId)) as unknown as KnowledgePoint[];
  } catch {
    kpTrees[subjectId] = [];
  }
}

function startEdit() {
  editing.value = true;
  syncImages();
  if (form.subjectId) ensureKpTree(form.subjectId);
}
function cancelEdit() {
  editing.value = false;
  // 还原
  const q = question.value;
  if (!q) return;
  form.type = q.type;
  form.stem = q.stem || '';
  form.difficulty = q.difficulty ?? 3;
  form.analysis = q.analysis || '';
  form.status = q.status || 'PUBLISHED';
  form.subjectId = q.subject?.id || undefined;
  form.paperName = q.sourcePaperName || '';
  form.score = typeof q.content?.score === 'number' ? q.content.score : 0;
  form.tagIds = (q.tags || []).map((t: any) => t.id);
  form.knowledgePointIds = (q.knowledgePoints || []).map((k: any) => k.id);
  form.options = Array.isArray(q.content?.options) ? q.content.options.map((o: any) => ({ ...o })) : [];
}

async function generateSolution() {
  const id = question.value?.id;
  if (!id || solvingQuestions[id]) return; // 已在进行中则直接拦截，避免重复触发后台解答
  solvingQuestions[id] = true;
  try {
    const res = await questionsApi.solve(id);
    if (!res) {
      ElMessage.warning('未配置文本模型密钥（系统设置 → 文本模型），无法生成解答');
    } else {
      ElMessage.success('AI 解答已生成，解析与步骤已写入');
      await load();
    }
  } catch {
    /* 拦截器已提示 */
  } finally {
    solvingQuestions[id] = false;
  }
}

async function save() {
  saving.value = true;
  try {
    // 题库硬性要求：每道题都必须归属到一张试卷
    if (!form.paperName || !form.paperName.trim()) {
      saving.value = false;
      ElMessage.warning('请填写「所属试卷」后再保存：题库中每道题都必须归属到一张试卷');
      return;
    }
    // 阅读理解大题：题干（引语）可空，给占位标题
    if (form.type === 'READING_COMPREHENSION' && !form.stem.trim()) form.stem = '阅读理解';
    const content: QuestionContent = { ...(question.value.content || {}) };
    if (isChoice.value) {
      content.options = form.options.map((o) => ({ key: o.key, text: o.text, correct: !!o.correct }));
      content.answer = optionsToAnswer(form.options);
    } else {
      delete content.options;
    }
    // 阅读理解/材料题：保存小题列表（correct 布尔 → options + answer）
    if (form.type === 'READING_COMPREHENSION' || form.type === 'MATERIAL') {
      content.subQuestions = subQuestionsToContent(form.subQuestions);
    }
    // 简答/论述：含多个小问时保存小题列表
    if ((form.type === 'SHORT_ANSWER' || form.type === 'ESSAY') && form.subQuestions.length) {
      content.subQuestions = subQuestionsToContent(form.subQuestions);
    }
    // 分值：题干中剥离出的「（X分）」+ 人工填写
    if (typeof form.score === 'number' && Number.isFinite(form.score) && form.score > 0) {
      content.score = form.score;
    } else {
      delete content.score;
    }
    delete (content as any).images;
    const payload: any = {
      type: form.type,
      stem: form.stem,
      content,
      analysis: form.analysis,
      difficulty: form.difficulty,
      status: form.status,
      subjectId: form.subjectId,
      tagIds: form.tagIds,
      knowledgePointIds: form.knowledgePointIds,
      sourcePaperName: form.paperName,
    };
    await questionsApi.update(question.value.id, payload);
    // 题图走原子接口 PATCH /questions/:id/images，避免整体 content 重复写，并与审阅台/抽屉共用校验去重。
    // 合并来源原图（mergedImages）不参与题图编辑，但需随题图一并写回，避免保存时丢失。
    await questionsApi.setImages(question.value.id, [...images.value, ...mergedImages.value]);
    ElMessage.success('已保存');
    editing.value = false;
    await load();
  } catch {
    /* 拦截器已提示 */
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    const [s, t] = await Promise.all([
      subjectsApi.tree() as unknown as Promise<Subject[]>,
      tagsApi.list() as unknown as Promise<Tag[]>,
    ]);
    subjects.value = s;
    tags.value = t;
  } catch {
    /* ignore */
  }
  load();
});

watch(
  () => route.params.id,
  () => load(),
);

// 来源试卷：打开题库「按试卷」窗口（可关闭可返回，按大题分组展示该卷题目，可编辑试卷）
// 详情页有 sourceFileId（关联的录入任务），带上后窗口里的「编辑试卷」按钮才会显示
function goSourcePaper(name: string) {
  const jobId = (question.value as any)?.sourceFileId ?? undefined;
  openPaperWindow('paper', name, jobId);
}
// 来源作业本：打开题库「按作业本」窗口（章节树 + 题目，章节在作业本视图内管理）
function goSourceWorkbook() {
  const id = (question.value as any)?.workbookId;
  const name = (question.value as any)?.sourcePath?.[0] || (question.value as any)?.sourcePaperName || '作业本';
  if (id) openPaperWindow('workbook', name, id);
}
// 组卷 Paper：跳到智能组卷页并自动预览该卷
function goPaper(paperId: string) {
  router.push({ path: '/teacher/compose', query: { paperId } });
}
</script>

<template>
  <div class="qd" v-loading="loading">
    <div class="qd__top">
      <el-button :icon="'ArrowLeft'" @click="router.back()">返回</el-button>
      <h2 class="qd__title">题目详情</h2>
      <div class="qd__spacer" />
      <el-button :icon="'MagicStick'" :loading="isSolving" :disabled="isSolving" @click="generateSolution">
        {{ hasSolution ? '重新生成答案' : '生成 AI 解答' }}
      </el-button>
      <el-button v-if="!editing" type="primary" :icon="'Edit'" @click="startEdit">编辑</el-button>
    </div>

    <div v-if="question" class="qd__body" :class="{ 'qd__body--stack': ltMd }">
      <!-- 左：裁切原图 + 合并来源原图（同款大图） -->
      <div class="qd__image">
        <div class="qd__image-label">
          试卷裁切原图<span v-if="keptPaper" class="qd__image-paper">（{{ keptPaper }}）</span>
        </div>
        <div class="qd__image-box">
          <img v-if="croppedUrl" :src="croppedUrl" alt="题目原图" class="qd__img" />
          <el-empty v-else description="无来源原图（非图片 OCR 录入）" :image-size="80" />
        </div>
        <!-- 合并来源原图：与上方裁切原图同款大图，标注各自来源试卷；下方折叠展示该题的识别内容与 AI 解答（图文对应） -->
        <div v-for="m in mergedImages" :key="m.cropId" class="qd__merged">
          <div class="qd__image-box">
            <img :src="questionsApi.figureUrl(m.cropId)" :alt="m.paper || '合并来源原图'" class="qd__img" />
          </div>
          <div class="qd__merged-paper">合并来源 · 试卷：<b>{{ m.paper || '未知' }}</b></div>
          <!-- 该原图对应合并题的识别内容 + AI 解答（默认收起） -->
          <template v-if="mergedQuestionOf(m.cropId)">
            <el-collapse class="qd__merged-collapse">
              <el-collapse-item :name="m.cropId">
                <template #title>
                  <span class="qd__merged-collapse-title">AI 识别内容</span>
                </template>
                <QuestionContentView
                  :type="mergedQuestionOf(m.cropId)!.type"
                  :stem="mergedQuestionOf(m.cropId)!.stem"
                  :content="mergedQuestionOf(m.cropId)!.content"
                  :analysis="mergedQuestionOf(m.cropId)!.analysis"
                  compact
                />
                <!-- AI 解答（答题步骤）：solve 生成后回填 solution 字段 -->
                <div
                  v-if="mergedQuestionOf(m.cropId)!.solution"
                  class="qd__merged-solution"
                >
                  <div class="qd__merged-solution-label">AI 解答：</div>
                  <MathText :value="mergedQuestionOf(m.cropId)!.solution || ''" :inline="false" />
                </div>
                <div v-else class="qd__merged-solution-empty">（该题未生成 AI 解答）</div>
              </el-collapse-item>
            </el-collapse>
          </template>
        </div>
        <!-- 无对应原图的合并题（来源非裁切图等）：纯文字折叠块，内容不丢 -->
        <div v-if="mergedTextOnly.length" class="qd__merged qd__merged--text">
          <el-collapse class="qd__merged-collapse">
            <el-collapse-item v-for="m in mergedTextOnly" :key="m.id" :name="m.id">
              <template #title>
                <span class="qd__merged-collapse-title">
                  合并题 · {{ m.sourcePapers[0] || m.sourcePaperName || '未知试卷' }}
                </span>
              </template>
              <QuestionContentView
                :type="m.type"
                :stem="m.stem"
                :content="m.content"
                :analysis="m.analysis"
                compact
              />
              <div v-if="m.solution" class="qd__merged-solution">
                <div class="qd__merged-solution-label">AI 解答：</div>
                <MathText :value="m.solution" :inline="false" />
              </div>
              <div v-else class="qd__merged-solution-empty">（该题未生成 AI 解答）</div>
            </el-collapse-item>
          </el-collapse>
        </div>
        <!-- 分值（放图片下方，识别时题干已剥离；可填可改，AI 解题按分值给得分点） -->
        <div class="qd__score">
          <span class="qd__score-label">分值</span>
          <el-input-number
            v-if="editing"
            v-model="form.score"
            :min="0"
            :max="100"
            :controls="false"
            size="small"
            style="width: 76px"
          />
          <b v-else>{{ typeof question.content?.score === 'number' ? question.content.score : 0 }}</b>
          <span class="qd__score-tip">分</span>
        </div>
        <!-- 题内图片（OCR 识别题图，入库后展示；只读、点开预览大图） -->
        <div v-if="!editing && viewImages.length" class="qd__figs">
          <div class="qd__figs-label">题内图片：</div>
          <QuestionImageEditor :model-value="viewImages" readonly />
        </div>
      </div>

      <!-- 右：文字 + 编辑 -->
      <div class="qd__main">
        <!-- 查看态 -->
        <template v-if="!editing">
          <div class="qd__meta">
            <el-tag size="small">{{ QUESTION_TYPE_LABEL[question.type as QuestionType] }}</el-tag>
            <el-rate :model-value="question.difficulty" disabled size="small" />
            <el-tag v-if="question.subject" size="small" type="info">{{ question.subject.name }}</el-tag>
            <el-tag v-for="t in question.tags" :key="t.id" size="small" effect="plain">{{ t.name }}</el-tag>
          </div>
          <QuestionContentView
            :type="question.type"
            :stem="question.stem"
            :content="question.content"
            :analysis="question.analysis"
          />

          <!-- 所属试卷：来源作业本（点击看作业本）/ 来源试卷（点击看全卷）+ 组卷引用（点击跳组卷） -->
          <div class="qd__papers">
            <div v-if="question.workbookId" class="qd__paper-block">
              <span class="qd__paper-label">来源作业本：</span>
              <el-tag
                type="warning"
                effect="plain"
                class="qd__paper-tag"
                @click="goSourceWorkbook"
              >{{ (question.sourcePath && question.sourcePath[0]) || '作业本' }}</el-tag>
            </div>
            <div v-if="question.sourcePapers?.length" class="qd__paper-block">
              <span class="qd__paper-label">来源试卷：</span>
              <el-tag
                v-for="p in question.sourcePapers"
                :key="p"
                type="primary"
                effect="plain"
                class="qd__paper-tag"
                @click="goSourcePaper(p)"
              >{{ p }}</el-tag>
            </div>
            <div v-if="question.papers?.length" class="qd__paper-block">
              <span class="qd__paper-label">组卷引用：</span>
              <el-tag
                v-for="p in question.papers"
                :key="p.id"
                type="success"
                effect="plain"
                class="qd__paper-tag"
                @click="goPaper(p.id)"
              >{{ p.title }}</el-tag>
            </div>
          </div>
        </template>

        <!-- 编辑态（同页切换） -->
        <template v-else>
          <el-form label-position="top" class="qd__form">
            <el-form-item label="题型">
              <el-select v-model="form.type" style="width: 100%">
                <el-option v-for="o in QUESTION_TYPE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="题干（支持 $LaTeX$ 公式）">
              <el-input v-model="form.stem" type="textarea" :rows="3" />
              <MathText :value="form.stem" :inline="false" />
            </el-form-item>

            <el-form-item label="题图">
              <QuestionImageEditor v-model="images" />
            </el-form-item>

            <el-form-item v-if="isChoice" label="选项">
              <OptionsEditor :model-value="form.options" :single="form.type === 'SINGLE_CHOICE'" />
            </el-form-item>

            <!-- 阅读理解：小题列表（题型 + 题干 + 选项 + 正确项勾选） -->
            <el-form-item v-if="form.type === 'READING_COMPREHENSION'" label="小题（选择 / 简答，可勾选正确项）">
              <SubQuestionsEditor :model-value="form.subQuestions" show-type />
            </el-form-item>

            <!-- 简答/论述：含多个小问时逐个填写小题干+答案，题型可改 -->
            <el-form-item v-if="form.type === 'SHORT_ANSWER' || form.type === 'ESSAY'" label="小题（多个小问时逐个填写，答案可选；题型可改）">
              <SubQuestionsEditor :model-value="form.subQuestions" show-type />
            </el-form-item>

            <el-form-item label="难度">
              <el-rate v-model="form.difficulty" />
            </el-form-item>
            <el-form-item label="解析">
              <el-input v-model="form.analysis" type="textarea" :rows="2" />
              <MathText v-if="form.analysis" :value="form.analysis" :inline="false" />
            </el-form-item>
            <el-form-item label="所属试卷">
              <el-input v-model="form.paperName" placeholder="如 2023 高考数学全国卷 I" />
            </el-form-item>
            <el-form-item label="学科">
              <el-tree-select
                v-model="form.subjectId"
                :data="subjects"
                :props="SUBJECT_TREE_PROPS"
                check-strictly
                clearable
                style="width: 100%"
                @change="ensureKpTree(form.subjectId || '')"
              />
            </el-form-item>
            <el-form-item label="知识点">
              <el-tree-select
                v-model="form.knowledgePointIds"
                :data="kpTrees[form.subjectId || ''] || []"
                :props="KP_TREE_PROPS"
                check-strictly
                multiple
                clearable
                style="width: 100%"
              />
            </el-form-item>
            <el-form-item label="标签">
              <el-select v-model="form.tagIds" multiple filterable allow-create default-first-option style="width: 100%">
                <el-option v-for="t in tags" :key="t.id" :label="t.name" :value="t.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="form.status" style="width: 100%">
                <el-option v-for="s in STATUS_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="save">保存</el-button>
              <el-button @click="cancelEdit">取消</el-button>
            </el-form-item>
          </el-form>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qd { display: flex; flex-direction: column; gap: var(--space-4); }
.qd__top { display: flex; align-items: center; gap: var(--space-3); }
.qd__title { font-size: 18px; font-weight: 700; margin: 0; }
.qd__spacer { flex: 1; }
.qd__body { display: flex; gap: var(--space-6); align-items: flex-start; }
.qd__body--stack { flex-direction: column; }
.qd__image { flex: 0 0 42%; max-width: 42%; }
.qd__body--stack .qd__image { flex: none; max-width: 100%; width: 100%; }
.qd__image-label { font-size: 13px; font-weight: 600; color: var(--c-text-muted); margin-bottom: 6px; }
.qd__image-paper { color: var(--c-text-muted); font-weight: 400; }
.qd__merged { margin-top: var(--space-3); }
.qd__merged-paper { font-size: 12px; color: var(--c-text-muted); margin-top: 4px; text-align: center; }
/* 合并题识别内容 / AI 解答（默认收起的折叠块，紧贴对应原图，图文对照） */
.qd__merged-collapse { margin-top: 6px; border-top: 1px dashed var(--c-border); }
.qd__merged-collapse-title { font-size: 12px; font-weight: 600; color: var(--c-text-muted); }
.qd__merged-collapse :deep(.el-collapse-item__header) { height: 32px; line-height: 32px; }
.qd__merged-collapse :deep(.el-collapse-item__content) { padding-bottom: 8px; font-size: 13px; }
.qd__merged-solution { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--c-border); }
.qd__merged-solution-label { font-size: 12px; color: var(--c-text-subtle); font-weight: 600; margin-bottom: 2px; }
.qd__merged-solution-empty { font-size: 12px; color: var(--c-text-subtle); margin-top: 4px; }
.qd__image-box {
  border: 1px solid var(--c-border); border-radius: var(--radius-md);
  background: var(--c-bg-subtle, #f5f7fa); padding: var(--space-3);
  display: flex; justify-content: center;
}
.qd__img { max-width: 100%; height: auto; border-radius: 6px; }
.qd__main { flex: 1; min-width: 0; }
/* 分值（图片下方） */
.qd__score {
  display: flex; align-items: center; gap: 6px; margin-top: 6px;
  padding: 4px 8px; background: var(--c-surface-2, #f5f7fa); border-radius: 6px;
}
.qd__score-label { font-size: 12px; font-weight: 600; color: var(--c-text-muted); }
.qd__score-tip { font-size: 11px; color: var(--c-text-subtle); }
/* 题内图片 */
.qd__figs { margin-top: 8px; }
.qd__figs-label { font-size: 12px; font-weight: 600; color: var(--c-text-muted); margin-bottom: 4px; }
.qd__figs-list { display: flex; flex-wrap: wrap; gap: 8px; }
.qd__fig { width: 96px; height: 96px; object-fit: cover; border: 1px solid var(--c-border); border-radius: 6px; cursor: zoom-in; }
.qd__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: var(--space-3); }
.qd__paper { font-size: 13px; color: var(--c-text-subtle); }
.qd__papers { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-4); }
.qd__paper-block { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.qd__paper-label { font-size: 13px; font-weight: 600; color: var(--c-text-muted); }
.qd__paper-tag { cursor: pointer; }
.qd__form :deep(.el-form-item) { margin-bottom: var(--space-3); }
</style>
