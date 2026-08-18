<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ingestApi, type DetectResponse } from '../../api/ingest';
import QuestionImageEditor from '../../components/biz/QuestionImageEditor.vue';
import { subjectsApi } from '../../api/subjects';
import { tagsApi } from '../../api/tags';
import { knowledgeApi } from '../../api/knowledge';
import {
  QUESTION_TYPE_LABEL,
  QUESTION_TYPE_OPTIONS,
  SUBJECT_TREE_PROPS,
  KP_TREE_PROPS,
  INGEST_JOB_STATUS_LABEL,
  OCR_ITEM_STATUS_LABEL,
  type Subject,
  type Tag,
  type KnowledgePoint,
  type IngestJob,
  type OcrItem,
  type KnowledgePointSuggestion,
  type QuestionType,
  type QuestionOption,
  type QuestionContent,
  type Workbook,
  type WorkbookSectionNode,
} from '../../types/models';
import { subQuestionsToContent, optionsToAnswer, type SubQuestionEdit } from '../../types/subQuestion';
import MathText from '../../components/base/MathText.vue';
import SubQuestionsEditor from '../../components/base/SubQuestionsEditor.vue';
import OptionsEditor from '../../components/base/OptionsEditor.vue';
import { workbookApi } from '../../api/workbook';
import WbSectionTree from '../../components/biz/WbSectionTree.vue';

const loading = ref(false);
const jobs = ref<IngestJob[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);

const subjects = ref<Subject[]>([]);
const tags = ref<Tag[]>([]);
const uploadSubjectId = ref<string>();

// 上传
const uploadFile = ref<File | null>(null);
const uploading = ref(false);
function onFileChange(file: any) {
  uploadFile.value = file?.raw ?? null;
}
async function doUpload() {
  if (!uploadFile.value) return ElMessage.warning('请先选择图片或 PDF');
  uploading.value = true;
  try {
    await ingestApi.upload(uploadFile.value, uploadSubjectId.value, uploadFile.value.name);
    ElMessage.success('上传成功，进入「自动框选」');
    uploadFile.value = null;
    loadJobs();
  } catch {
    /* 拦截器已提示 */
  } finally {
    uploading.value = false;
  }
}

// 步骤 2/4 共享的"识别中"标记（自动框选 / AI 识别题目 都会置位）
const detectingId = ref<string | null>(null);
const recognizingId = ref<string | null>(null);
async function doRecognize(job: IngestJob) {
  recognizingId.value = job.id;
  try {
    const res = (await ingestApi.recognize(job.id, uploadSubjectId.value)) as unknown as {
      job: IngestJob;
      skippedIndexes: number[];
      aiAssignedTypes?: { index: number; type: string }[];
    };
    if (res.skippedIndexes?.length) {
      ElMessage.warning(
        `第 ${res.skippedIndexes.join('、')} 题 AI 未能判断题型，已跳过——请到审阅台为这些题选择题型后重新识别`,
      );
    } else {
      ElMessage.success('识别完成，已生成候选题目，进入审阅台');
    }
    // 题型：除非人工选择过，否则一直由 AI 判断——识别后给出明确提示
    const ai = res.aiAssignedTypes || [];
    if (ai.length) {
      const labelMap: Record<string, string> = {
        SINGLE_CHOICE: '单选题', MULTIPLE_CHOICE: '多选题', TRUE_FALSE: '判断题',
        FILL_BLANK: '填空题', SHORT_ANSWER: '简答题', ESSAY: '论述题',
        MATERIAL: '材料题', READING_COMPREHENSION: '阅读理解',
      };
      const text = ai.map((x) => `第 ${x.index} 题 → ${labelMap[x.type] || x.type}`).join('、');
      ElMessage({ type: 'info', message: `AI 已判断题型：${text}。可在审阅台逐题修改。`, duration: 6000, grouping: true });
    }
    // 整页重识别是显式动作：服务端会用 AI 结果覆盖每题内容，
    // 因此清除所有 dirty 标记，让每题（含正在手改的题）都刷新为最新识别结果。
    for (const it of res.job.items || []) clearDirty(it.id);
    loadJobs();
    openReview(res.job);
  } catch {
    /* 拦截器已提示 */
  } finally {
    recognizingId.value = null;
  }
}

// 审阅台单题重新识别（逐题重跑 VLM，复用已有裁切 cropId）。
// 用 Set 支持多题并发识别：点第 2 题不会打断第 1 题的识别。
const rerecognizingIds = reactive<Set<string>>(new Set());
async function reRecognizeItem(item: OcrItem) {
  if (rerecognizingIds.has(item.id)) return; // 该题已在识别中，防重复触发
  rerecognizingIds.add(item.id);
  try {
    // 识别前先持久化当前题型（识别按后端 item.type 作为约束）
    await persistItem(item);
    const updated = (await ingestApi.recognizeItem(item.id, uploadSubjectId.value)) as unknown as OcrItem;
    // 直接用服务端返回的最新识别结果覆盖本地，避免「状态不刷新 / 被旧值覆盖成空白」
    const job = activeJob.value;
    if (job && job.items) {
      const idx = job.items.findIndex((x) => x.id === updated.id);
      if (idx >= 0) job.items[idx] = { ...job.items[idx], ...updated } as any;
      else job.items = [...job.items, updated as any];
    }
    clearDirty(item.id);
    editForms[item.id] = initEdit(updated);
    delete dirtyItems[item.id];
    ElMessage.success(`第 ${item.index} 题已重新识别`);
  } catch {
    /* 拦截器已提示 */
  } finally {
    rerecognizingIds.delete(item.id);
  }
}

// 删除录入任务
async function removeJob(job: IngestJob) {
  try {
    await ElMessageBox.confirm(`确认删除录入任务「${job.fileName}」？该操作不可恢复。`, '确认删除', {
      type: 'warning',
    });
    await ingestApi.remove(job.id);
    ElMessage.success('已删除');
    loadJobs();
  } catch {
    /* cancel */
  }
}

async function loadJobs() {
  loading.value = true;
  try {
    const res = (await ingestApi.list({ page: page.value, pageSize: pageSize.value })) as unknown as {
      items: IngestJob[];
      total: number;
      page: number;
      pageSize: number;
    };
    jobs.value = res.items;
    total.value = res.total;
  } catch {
    /* 拦截器已提示 */
  } finally {
    loading.value = false;
  }
}

// 当前步骤（仅用于顶部步骤条高亮）。注意：AI 解答已移出录入流程，统一在题库入库后触发。
const pipelineSteps = [
  '上传图片',
  '自动框选题目',
  '人工核对/修改框',
  'AI 识别题目',
  '标注属性与试卷',
  '入库（解答在题库生成）',
];
function stepActive(job: IngestJob): number {
  switch (job.status) {
    case 'UPLOADED':
      return 0;
    case 'SEGMENTING':
      return 2;
    case 'RECOGNIZING':
      return 3;
    case 'REVIEWING':
      return 4;
    case 'DONE':
      return 5;
    default:
      return 0;
  }
}

// 日期格式化：YYYY-MM-DD HH:mm:ss
function formatDateTime(s?: string): string {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 按钮可用性：只要有框选（AI 或人工新增的题框），就能「识别题目」与「审阅台」，
// 不再按 job.status 判断——因为人工新增框不会改变 job 状态（仍可能是 UPLOADED），
// 否则会出现「明明有框却点不了审阅台/识别」的卡死。
const hasBoxes = (j: IngestJob) => (j._count?.items ?? 0) > 0;
const canRecognize = hasBoxes;

// ---------------- 框选编辑器（步骤 2/3） ----------------
const bboxVisible = ref(false);
const bboxJob = ref<IngestJob | null>(null);
const bboxPageIndex = ref(0);
const pageImageUrl = ref<string>('');
// 框选新增模式：'question'=题目框，'figure'=页面级图片框（与题目框解耦），null=不新增
const addBoxMode = ref<'question' | 'figure' | null>(null);
// 页面级图片框（独立实体，不绑定任何题目）：[{bbox, cropId?, label?}]
const localPageFigures = ref<Array<{ bbox: number[]; cropId?: string; label?: string }>>([]);
const drawing = ref<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
const savingBoxId = ref<string | null>(null);
const imgWrap = ref<HTMLElement | null>(null);

// 本地响应式选框（保证拖拽时实时跟随鼠标）
// 三类框：普通（可编辑）、合并题原始框（只读+「已合并」）、已入库框（只读+「已入库」）
const localBoxes = ref<EditBox[]>([]);
function syncLocalBoxes() {
  if (!bboxJob.value) {
    localBoxes.value = [];
    return;
  }
  const page = bboxJob.value.pages?.[bboxPageIndex.value];
  if (!page) {
    localBoxes.value = [];
    return;
  }
  const pageItems = (bboxJob.value.items || []).filter((i) => i.pageId === page.id);
  const byId = new Map(pageItems.map((i) => [i.id, i]));
  const out: EditBox[] = [];
  // 1) 普通框 + 合并主项（显示合并前自身原始框，只读）
  const normals = pageItems
    .filter((i) => !i.mergedIntoId && !i.mergedFromImagePath)
    .sort((a, b) => (a.number ?? a.index) - (b.number ?? b.index))
    .map((i) => {
      const bb = ((i.bbox as number[]) || [0.05, 0.05, 0.95, 0.95]) as [number, number, number, number];
      return {
        id: i.id,
        index: i.index,
        number: i.number ?? null,
        bbox: bb,
        type: i.type || '',
        status: i.status,
        approved: i.status === 'APPROVED',
        figures: (i.figures as any[]) || [],
      } as EditBox;
    });
  out.push(...normals);
  // 2) 合并主项：显示合并前自身框（只读，标注已合并）
  for (const i of pageItems) {
    if (!i.mergedFromImagePath) continue;
    const pre = (i.mergedFromBbox as number[]) || null;
    if (pre && pre.length === 4) {
      out.push({
        id: i.id,
        index: i.index,
        number: i.number ?? null,
        bbox: [pre[0], pre[1], pre[2], pre[3]] as [number, number, number, number],
        type: i.type || '',
        status: i.status,
        mergedMain: true,
        figures: (i.figures as any[]) || [],
      } as EditBox);
    }
    // 被合并项（同页时也在本页显示其原始框，只读）
    const merged = (bboxJob.value.items || []).find((m) => m.mergedIntoId === i.id);
    if (merged && merged.pageId === page.id && merged.bbox) {
      const mb = merged.bbox as number[];
      if (mb.length === 4) {
        out.push({
          id: merged.id,
          index: merged.index,
          bbox: [mb[0], mb[1], mb[2], mb[3]] as [number, number, number, number],
          type: merged.type || '',
          status: merged.status,
          merged: true,
        } as EditBox);
      }
    }
  }
  // 3) 被合并项（独立出现且未在主项同页展示时）：只读框
  for (const i of pageItems) {
    if (!i.mergedIntoId) continue;
    const main = byId.get(i.mergedIntoId);
    if (main && main.pageId === page.id) continue; // 已由主项带出
    const mb = (i.bbox as number[]) || [0.05, 0.05, 0.95, 0.95];
    out.push({
      id: i.id,
      index: i.index,
      bbox: [mb[0], mb[1], mb[2], mb[3]] as [number, number, number, number],
      type: i.type || '',
      status: i.status,
      merged: true,
    } as EditBox);
  }
  localBoxes.value = out.sort((a, b) => (a.number ?? a.index) - (b.number ?? b.index));
  // 页面级图片框：与题目框解耦，独立加载（手绘的可在任何位置，不归属于某题）
  const pgFigs = (bboxJob.value?.pages?.[bboxPageIndex.value] as any)?.figures;
  localPageFigures.value = Array.isArray(pgFigs) ? (pgFigs as Array<{ bbox: number[]; cropId?: string; label?: string }>) : [];
}

interface EditBox {
  id: string;
  index: number;
  /** 试卷题号（右侧面板排序后可能不等于 index；显示统一用 number ?? index，与审阅台一致） */
  number?: number | null;
  bbox: [number, number, number, number];
  type?: string;
  status: string;
  /** 已入库（不可删除，改框会刷新入库状态） */
  approved?: boolean;
  /** 合并主项：显示合并前自身原始框（只读） */
  mergedMain?: boolean;
  /** 被合并项（只读） */
  merged?: boolean;
  /** 题内图片区域 */
  figures?: Array<{ bbox: number[]; cropId?: string; label?: string }>;
}

const currentPage = computed(() => bboxJob.value?.pages?.[bboxPageIndex.value] || null);

async function openBboxEditor(job: IngestJob) {
  // 列表行对象不含 pages/items，统一自取全量任务，避免「退出后再编辑框选」空白
  let full = job;
  try {
    full = (await ingestApi.get(job.id)) as unknown as IngestJob;
  } catch {
    /* 失败时回退使用原对象 */
  }
  bboxJob.value = full;
  bboxPageIndex.value = 0;
  bboxVisible.value = true;
  await loadBboxPage();
}
async function loadBboxPage() {
  if (!bboxJob.value) return;
  const page = bboxJob.value.pages?.[bboxPageIndex.value];
  if (!page) return;
  if (pageImageUrl.value) URL.revokeObjectURL(pageImageUrl.value);
  try {
    pageImageUrl.value = await ingestApi.pageImageUrl(page.id);
  } catch {
    pageImageUrl.value = '';
  }
  syncLocalBoxes();
}
async function reloadBboxJob() {
  if (!bboxJob.value) return;
  bboxJob.value = (await ingestApi.get(bboxJob.value.id)) as unknown as IngestJob;
  await loadBboxPage();
}
function closeBbox() {
  if (pageImageUrl.value) URL.revokeObjectURL(pageImageUrl.value);
  pageImageUrl.value = '';
  bboxJob.value = null;
  localBoxes.value = [];
  bboxVisible.value = false;
}
function prevPage() {
  if (bboxPageIndex.value > 0) {
    bboxPageIndex.value -= 1;
    loadBboxPage();
  }
}
function nextPage() {
  if (bboxJob.value && bboxPageIndex.value < (bboxJob.value.pages?.length || 1) - 1) {
    bboxPageIndex.value += 1;
    loadBboxPage();
  }
}
async function reDetect() {
  if (!bboxJob.value) return;
  detectingId.value = bboxJob.value.id;
  startDetectProgress(bboxJob.value.id);
  try {
    const res = (await ingestApi.detect(bboxJob.value.id, uploadSubjectId.value)) as unknown as DetectResponse;
    ElMessage.success('AI 已自动框选题目，请在编辑器中核对/调整框');
    await reloadBboxJob();
  } catch {
    /* 拦截器已提示 */
  } finally {
    stopDetectProgress();
    detectingId.value = null;
  }
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
function norm(e: PointerEvent): [number, number] {
  const r = imgWrap.value!.getBoundingClientRect();
  return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
}
const dragState = ref<{
  id: string;
  mode: 'move' | 'resize';
  sx: number;
  sy: number;
  start: [number, number, number, number];
} | null>(null);

function onBoxDown(e: PointerEvent, box: EditBox) {
  // 只读框（已合并/被合并项）不可拖动；已入库框允许拖（改框会刷新入库状态）
  if (box.mergedMain || box.merged) return;
  e.preventDefault();
  e.stopPropagation();
  try {
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
  } catch {
    /* 部分浏览器不支持，忽略 */
  }
  dragState.value = { id: box.id, mode: 'move', sx: e.clientX, sy: e.clientY, start: [...box.bbox] };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
function onResizeDown(e: PointerEvent, box: EditBox) {
  if (box.mergedMain || box.merged) return;
  e.preventDefault();
  e.stopPropagation();
  try {
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
  } catch {
    /* 忽略 */
  }
  dragState.value = { id: box.id, mode: 'resize', sx: e.clientX, sy: e.clientY, start: [...box.bbox] };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
function onMove(e: PointerEvent) {
  const d = dragState.value;
  if (!d || !imgWrap.value) return;
  const r = imgWrap.value.getBoundingClientRect();
  const dx = (e.clientX - d.sx) / r.width;
  const dy = (e.clientY - d.sy) / r.height;
  const b = localBoxes.value.find((x) => x.id === d.id);
  if (!b) return;
  if (d.mode === 'move') {
    const w = d.start[2] - d.start[0];
    const h = d.start[3] - d.start[1];
    let x0 = clamp(d.start[0] + dx);
    let y0 = clamp(d.start[1] + dy);
    if (x0 + w > 1) x0 = 1 - w;
    if (y0 + h > 1) y0 = 1 - h;
    b.bbox = [x0, y0, x0 + w, y0 + h];
  } else {
    const x1 = clamp(d.start[2] + dx);
    const y1 = clamp(d.start[3] + dy);
    b.bbox = [d.start[0], d.start[1], Math.max(x1, d.start[0] + 0.02), Math.max(y1, d.start[1] + 0.02)];
  }
}
async function onUp() {
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  const d = dragState.value;
  dragState.value = null;
  if (!d) return;
  const b = localBoxes.value.find((x) => x.id === d.id);
  if (b) await persistBox(b);
}
async function persistBox(b: EditBox) {
  savingBoxId.value = b.id;
  try {
    await ingestApi.review(b.id, {
      // 合并主项：只提交题图 figures，不提交 bbox（bbox 为合并前原始框，只读展示）
      ...(b.mergedMain ? {} : { bbox: b.bbox }),
      figures: (b.figures || [])
        .map((f) => ({
          bbox: Array.isArray(f.bbox) && f.bbox.length === 4 ? f.bbox : undefined,
          cropId: f.cropId,
          label: f.label,
        }))
        .filter((f) => !!f.bbox) as Array<{ bbox: number[]; cropId?: string; label?: string }>,
    });
    if (b.approved) {
      // 后端已把该题重置为待识别：本地刷新状态与提示
      ElMessage.warning('已修改已入库题目的框：入库状态已刷新，需重新识别后再次入库');
      b.approved = false;
      await reloadBboxJob();
    }
  } catch {
    /* 拦截器已提示 */
  } finally {
    savingBoxId.value = null;
  }
}
async function deleteBox(b: EditBox) {
  if (b.approved) return ElMessage.warning('该题已入库，框不可删除（保留供追溯）。如需修改请到题库操作');
  if (b.mergedMain || b.merged) return ElMessage.warning('已合并的框不可单独删除，请先「撤销合并」');
  try {
    await ElMessageBox.confirm('删除该框选区域？题目数将同步减少。', '确认', { type: 'warning' });
    await ingestApi.review(b.id, { status: 'DISCARDED' });
    ElMessage.success('已删除该框');
    await reloadBboxJob();
    loadJobs(); // 同步表格中的「题目数」
  } catch {
    /* cancel */
  }
}

// 试卷显示缩放（框坐标为归一化百分比，缩放不改变框位置）
const bboxScale = ref(100);

// 题内图片框：移动（拖动主体）/ 缩放（右下角把手）/ 删除（✕）/ 拖到另一题框 = 改归属
const figureDrag = ref<{
  boxId: string;
  fi: number;
  mode: 'move' | 'resize';
  sx: number;
  sy: number;
  start: number[];
  hoverBoxId?: string; // 拖动中悬停的目标题目框（改归属用）
} | null>(null);
function onFigureDown(e: PointerEvent, b: EditBox, fi: number) {
  e.preventDefault();
  e.stopPropagation();
  const f = b.figures?.[fi];
  if (!f) return;
  try {
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
  } catch {
    /* 忽略 */
  }
  figureDrag.value = { boxId: b.id, fi, mode: 'move', sx: e.clientX, sy: e.clientY, start: [...f.bbox] };
  window.addEventListener('pointermove', onFigureMove);
  window.addEventListener('pointerup', onFigureUp);
}
function onFigureResizeDown(e: PointerEvent, b: EditBox, fi: number) {
  e.preventDefault();
  e.stopPropagation();
  const f = b.figures?.[fi];
  if (!f) return;
  try {
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
  } catch {
    /* 忽略 */
  }
  figureDrag.value = { boxId: b.id, fi, mode: 'resize', sx: e.clientX, sy: e.clientY, start: [...f.bbox] };
  window.addEventListener('pointermove', onFigureMove);
  window.addEventListener('pointerup', onFigureUp);
}
function onFigureMove(e: PointerEvent) {
  const d = figureDrag.value;
  if (!d || !imgWrap.value) return;
  const r = imgWrap.value.getBoundingClientRect();
  const dx = (e.clientX - d.sx) / r.width;
  const dy = (e.clientY - d.sy) / r.height;
  const b = localBoxes.value.find((x) => x.id === d.boxId);
  const f = b?.figures?.[d.fi];
  if (!f) return;
  const [x0, y0, x1, y1] = d.start;
  if (d.mode === 'resize') {
    let nx1 = clamp(x1 + dx);
    let ny1 = clamp(y1 + dy);
    if (nx1 < x0 + 0.02) nx1 = x0 + 0.02;
    if (ny1 < y0 + 0.02) ny1 = y0 + 0.02;
    f.bbox = [x0, y0, nx1, ny1];
  } else {
    const w = x1 - x0;
    const h = y1 - y0;
    let nx0 = clamp(x0 + dx);
    let ny0 = clamp(y0 + dy);
    if (nx0 + w > 1) nx0 = 1 - w;
    if (ny0 + h > 1) ny0 = 1 - h;
    f.bbox = [nx0, ny0, nx0 + w, ny0 + h];
  }
  // 归属提示：拖动时检测悬停的目标题目框（改归属）
  d.hoverBoxId = undefined;
  if (d.mode === 'move') {
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    const boxEl = els.find(
      (el) => el.classList?.contains('bbox__box') && el.getAttribute('data-id') && el.getAttribute('data-id') !== d.boxId,
    );
    d.hoverBoxId = boxEl?.getAttribute('data-id') ?? undefined;
  }
}
async function onFigureUp() {
  window.removeEventListener('pointermove', onFigureMove);
  window.removeEventListener('pointerup', onFigureUp);
  const d = figureDrag.value;
  figureDrag.value = null;
  if (!d) return;
  const b = localBoxes.value.find((x) => x.id === d.boxId);
  if (!b) return;
  // 拖到另一题框上：图片归属改到目标题（原题移除、目标题追加）
  if (d.hoverBoxId && d.hoverBoxId !== d.boxId) {
    const target = localBoxes.value.find((x) => x.id === d.hoverBoxId);
    const f = b.figures?.[d.fi];
    if (target && f) {
      const fig = { ...f };
      b.figures = (b.figures || []).filter((_, i) => i !== d.fi);
      target.figures = [...(target.figures || []), fig];
      try {
        await persistBox(b);
        await persistBox(target);
        ElMessage.success(`题图已归属到 第 ${target.index} 题`);
      } catch {
        /* 拦截器已提示 */
      }
      return;
    }
  }
  await persistBox(b);
}
/** 删除题图框：从该题的 figures 移除并保存 */
async function deleteFigure(b: EditBox, fi: number) {
  try {
    await ElMessageBox.confirm('删除该题图框？识别后如需恢复可重新框选。', '删除题图', { type: 'warning' });
  } catch {
    return;
  }
  b.figures = (b.figures || []).filter((_, i) => i !== fi);
  await persistBox(b);
}
/** 悬停目标题的题号（归属提示用） */
function hoverBoxIndex(id: string): number | string {
  const t = localBoxes.value.find((x) => x.id === id);
  return t ? t.index : '';
}

// ---------------- 页面级图片框：移动 / 缩放 / 删除（独立于题目框） ----------------
const pageFigDrag = ref<{ fi: number; mode: 'move' | 'resize'; sx: number; sy: number; start: number[] } | null>(null);
function onPageFigureDown(e: PointerEvent, fi: number) {
  e.preventDefault();
  e.stopPropagation();
  const f = localPageFigures.value[fi];
  if (!f) return;
  try {
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
  } catch {
    /* 忽略 */
  }
  pageFigDrag.value = { fi, mode: 'move', sx: e.clientX, sy: e.clientY, start: [...f.bbox] };
  window.addEventListener('pointermove', onPageFigureMove);
  window.addEventListener('pointerup', onPageFigureUp);
}
function onPageFigureResizeDown(e: PointerEvent, fi: number) {
  e.preventDefault();
  e.stopPropagation();
  const f = localPageFigures.value[fi];
  if (!f) return;
  try {
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
  } catch {
    /* 忽略 */
  }
  pageFigDrag.value = { fi, mode: 'resize', sx: e.clientX, sy: e.clientY, start: [...f.bbox] };
  window.addEventListener('pointermove', onPageFigureMove);
  window.addEventListener('pointerup', onPageFigureUp);
}
function onPageFigureMove(e: PointerEvent) {
  const d = pageFigDrag.value;
  if (!d || !imgWrap.value) return;
  const r = imgWrap.value.getBoundingClientRect();
  const dx = (e.clientX - d.sx) / r.width;
  const dy = (e.clientY - d.sy) / r.height;
  const f = localPageFigures.value[d.fi];
  if (!f) return;
  const [x0, y0, x1, y1] = d.start;
  if (d.mode === 'resize') {
    let nx1 = clamp(x1 + dx);
    let ny1 = clamp(y1 + dy);
    if (nx1 < x0 + 0.02) nx1 = x0 + 0.02;
    if (ny1 < y0 + 0.02) ny1 = y0 + 0.02;
    f.bbox = [x0, y0, nx1, ny1];
  } else {
    const w = x1 - x0;
    const h = y1 - y0;
    let nx0 = clamp(x0 + dx);
    let ny0 = clamp(y0 + dy);
    if (nx0 + w > 1) nx0 = 1 - w;
    if (ny0 + h > 1) ny0 = 1 - h;
    f.bbox = [nx0, ny0, nx0 + w, ny0 + h];
  }
}
async function onPageFigureUp() {
  window.removeEventListener('pointermove', onPageFigureMove);
  window.removeEventListener('pointerup', onPageFigureUp);
  const d = pageFigDrag.value;
  pageFigDrag.value = null;
  if (!d) return;
  await persistPageFigures();
}
async function persistPageFigures() {
  const page = currentPage.value;
  if (!page) return;
  try {
    const updated = (await ingestApi.updatePageFigures(
      page.id,
      localPageFigures.value.map((f) => ({ bbox: f.bbox, cropId: f.cropId, label: f.label })),
    )) as Array<{ bbox: number[]; cropId?: string; label?: string }>;
    localPageFigures.value = updated;
    const pg = bboxJob.value?.pages?.[bboxPageIndex.value] as any;
    if (pg) pg.figures = updated;
  } catch {
    /* 拦截器已提示 */
  }
}
async function deletePageFigure(fi: number) {
  try {
    await ElMessageBox.confirm('删除该图片框？', '删除图片框', { type: 'warning' });
  } catch {
    return;
  }
  localPageFigures.value = localPageFigures.value.filter((_, i) => i !== fi);
  await persistPageFigures();
}

// ---------------- 题内图片：统一用 QuestionImageEditor（审阅台/题库共用） ----------------
// 可采用的「已框题图」来源：item.figures 中有裁切图(cropId)且尚未被采用的（按 cropId 去重）
function figurePool(item: OcrItem): { cropId?: string; label?: string; bbox?: number[] }[] {
  const taken = new Set(((editForms[item.id]?.images as { cropId: string }[]) || []).map((i) => i.cropId));
  // 页面级图片框（与题目框解耦）也作为可采用的候选：归属到该题目所在页即可被任意题采用
  const pages = (bboxJob.value?.pages || activeJob.value?.pages || []) as any[];
  const pageFigs = pages.find((p) => p.id === item.pageId)?.figures || [];
  const all = [...((item.figures as any[]) || []), ...(pageFigs as any[])];
  return all
    .filter(
      (f: any) =>
        (f?.cropId || (f?.bbox && Array.isArray(f.bbox) && f.bbox.length === 4)) && !taken.has(f.cropId),
    )
    .map((f: any) => ({ cropId: f.cropId, label: f.label || '题内图片', bbox: f.bbox }));
}
function onReviewImagesChange(item: OcrItem, v: { cropId: string; label?: string }[]) {
  const f = editForms[item.id];
  if (!f) return;
  f.images = v;
  markDirty(item.id);
}

function onWrapDown(e: PointerEvent) {
  if (!addBoxMode.value) return;
  const [x, y] = norm(e);
  drawing.value = { x0: x, y0: y, x1: x, y1: y };
  window.addEventListener('pointermove', onDrawMove);
  window.addEventListener('pointerup', onDrawUp);
}
function onDrawMove(e: PointerEvent) {
  if (!drawing.value || !imgWrap.value) return;
  const [x, y] = norm(e);
  drawing.value.x1 = x;
  drawing.value.y1 = y;
}
async function onDrawUp() {
  window.removeEventListener('pointermove', onDrawMove);
  window.removeEventListener('pointerup', onDrawUp);
  const d = drawing.value;
  drawing.value = null;
  const mode = addBoxMode.value;
  addBoxMode.value = null;
  if (!d || !bboxJob.value) return;
  const page = bboxJob.value.pages?.[bboxPageIndex.value];
  if (!page) return;
  const x0 = Math.min(d.x0, d.x1);
  const y0 = Math.min(d.y0, d.y1);
  const x1 = Math.max(d.x0, d.x1);
  const y1 = Math.max(d.y0, d.y1);
  if (x1 - x0 < 0.02 || y1 - y0 < 0.02) return;
  try {
    if (mode === 'figure') {
      // 页面级图片框：直接按页裁切，独立于任何题目
      const res = (await ingestApi.addPageFigure(page.id, [x0, y0, x1, y1])) as { bbox: number[]; cropId?: string; label?: string };
      localPageFigures.value = [...localPageFigures.value, res];
      const pg = bboxJob.value.pages?.[bboxPageIndex.value] as any;
      if (pg) pg.figures = [...(Array.isArray(pg.figures) ? pg.figures : []), res];
    } else {
      await ingestApi.addBox(page.id, [x0, y0, x1, y1]);
      await reloadBboxJob();
    }
  } catch {
    /* 拦截器已提示 */
  }
}

// ---------------- 审阅台（步骤 4/5） ----------------
const drawer = ref(false);
const activeJob = ref<IngestJob | null>(null);
const suggestions = ref<KnowledgePointSuggestion[]>([]);
const kpTrees = reactive<Record<string, KnowledgePoint[]>>({});

// 合并跨页截断题：右侧「大题与题号」面板拖拽到另一题 → 预览拼接图（可交换上下）→ 确认合并 → 可回退
const mergingItems = ref(false);
// 合并后主项显示拼接图（itemId -> ObjectURL）
const mergedImageMap = reactive<Record<string, string>>({});
// 合并预览弹窗
const mergeDialogVisible = ref(false);
const mergeDialog = ref<{
  a: OcrItem;
  b: OcrItem;
  blob: Blob;
  preview: string;
  aLabel: string;
  bLabel: string;
} | null>(null);

// AI 框选进度（进度条）
const detectProgress = ref<{ done: number; total: number; pageIndex: number } | null>(null);
let detectProgressTimer: ReturnType<typeof setInterval> | null = null;
const detectPercent = computed(() => {
  const p = detectProgress.value;
  if (!p || p.total <= 0) return 0;
  return Math.min(100, Math.round((p.done / p.total) * 100));
});
const detectLabel = computed(() => {
  const p = detectProgress.value;
  if (!p || p.total <= 0) return 'AI 框选进度…';
  return `AI 框选进度：第 ${p.done} / ${p.total} 页（当前第 ${p.pageIndex} 页）`;
});

// 按大题分组（groupIndex 相同的归一组，无分组的单独「未分组」），用于审阅台大题分栏。
// 被合并项（mergedIntoId 非空）不单独出现：已并入主项，以「两图两框」在主项卡片展示。
// 注：分组与排序逻辑与 reviewGroups（右侧面板）保持一致，见其定义处。

// 合并题的被合并项（审阅台两图两框：主项页原图 + 被合并项页原图）
function mergedChild(item: OcrItem): OcrItem | undefined {
  return activeJob.value?.items?.find((i) => i.mergedIntoId === item.id);
}

/** 由原始 bbox 数组生成高亮样式（兼容 mergedFromBbox） */
function bboxStyleFrom(bb?: number[] | null): Record<string, string> {
  if (!bb || bb.length !== 4) return {};
  const [x0, y0, x1, y1] = bb;
  return {
    left: `${x0 * 100}%`,
    top: `${y0 * 100}%`,
    width: `${(x1 - x0) * 100}%`,
    height: `${(y1 - y0) * 100}%`,
  };
}

// ---------------- 右侧「大题与题号」面板：拖拽分组 / 拖拽合并 / 大题标题编辑 ----------------
const reviewGroups = computed(() => {
  const items = (activeJob.value?.items || []).filter((i) => !i.mergedIntoId);
  const groups: { key: string; groupIndex: number | null; title: string; items: OcrItem[] }[] = [];
  for (const it of items) {
    const gi = it.groupIndex ?? null;
    const key = gi === null ? '__none__' : String(gi);
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, groupIndex: gi, title: it.groupTitle || (gi ? `第 ${gi} 大题` : '未分组'), items: [] };
      groups.push(g);
    }
    g.items.push(it);
  }
  // 组内按 number ?? index 排序（与右侧面板一致，保证「框与题目对应」）
  groups.forEach((g) => g.items.sort((a, b) => (a.number ?? a.index) - (b.number ?? b.index)));
  return groups;
});

// 左侧题卡也按 number 排序（与右侧面板顺序一致，避免「框和题目不对应」）
const groupedItems = computed(() => {
  const items = (activeJob.value?.items || []).filter((i) => !i.mergedIntoId);
  const groups: { key: string; groupIndex: number | null; groupTitle: string; items: OcrItem[] }[] = [];
  for (const it of items) {
    const gi = it.groupIndex ?? null;
    const key = gi === null ? '__none__' : String(gi);
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = {
        key,
        groupIndex: gi,
        groupTitle: it.groupTitle || (gi ? `第 ${gi} 大题` : '未分组'),
        items: [],
      };
      groups.push(g);
    }
    g.items.push(it);
  }
  groups.forEach((g) => g.items.sort((a, b) => (a.number ?? a.index) - (b.number ?? b.index)));
  return groups;
});
const jobRecognized = computed(() =>
  (activeJob.value?.items || []).some((it) => it.status === 'PENDING_REVIEW' || (it.attempts && it.attempts.length > 0)),
);

// 审阅台状态概览（系统可见性：让老师一眼看清还差多少题未入库）
const reviewStats = computed(() => {
  const items = (activeJob.value?.items || []) as OcrItem[];
  const pending = items.filter((i) => i.status !== 'APPROVED' && i.status !== 'REJECTED').length;
  const approved = items.filter((i) => i.status === 'APPROVED').length;
  const rejected = items.filter((i) => i.status === 'REJECTED').length;
  const merged = items.filter((i) => i.mergedFromImagePath).length;
  return { total: items.length, pending, approved, rejected, merged };
});
// 知识点建议面板默认展开（次级信息，可折叠不干扰主流程）
const sugOpen = ref<string[]>(['sug']);

// ---------------- 右侧面板：实时拖拽（题号 chip 跟随鼠标） ----------------
// 拖拽状态：x/y 为浮动 chip 的 fixed 坐标；over 为当前悬停意图（组=换大题 / 题=合并）
const railDragState = ref<{
  item: OcrItem;
  x: number;
  y: number;
  over: 'group' | 'item' | null;
  overKey?: string;
} | null>(null);

/** 当前题所在组 key */
function groupKeyOf(itemId: string): string | undefined {
  return reviewGroups.value.find((g) => g.items.some((it) => it.id === itemId))?.key;
}
function onRailItemDown(e: PointerEvent, it: OcrItem) {
  if (it.mergedIntoId) return; // 被合并项不拖
  e.preventDefault();
  e.stopPropagation();
  railDragState.value = { item: it, x: e.clientX, y: e.clientY, over: null };
  window.addEventListener('pointermove', onRailMove);
  window.addEventListener('pointerup', onRailUp);
}
function onRailMove(e: PointerEvent) {
  const d = railDragState.value;
  if (!d) return;
  d.x = e.clientX;
  d.y = e.clientY;
  d.over = null;
  d.overKey = undefined;
  const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
  if (!el) return;
  const itemEl = el.closest?.('.rail__item[data-id]');
  if (itemEl && itemEl !== e.target) {
    d.over = 'item';
    d.overKey = itemEl.getAttribute('data-id') ?? undefined;
    return;
  }
  const groupEl = el.closest?.('.rail__group[data-key]');
  if (groupEl) {
    d.over = 'group';
    d.overKey = groupEl.getAttribute('data-key') ?? undefined;
  }
}
async function onRailUp() {
  window.removeEventListener('pointermove', onRailMove);
  window.removeEventListener('pointerup', onRailUp);
  const d = railDragState.value;
  railDragState.value = null;
  if (!d) return;
  if (d.over === 'item' && d.overKey && d.overKey !== d.item.id) {
    const target = activeJob.value?.items?.find((x) => x.id === d.overKey);
    if (target) await mergeTwo(d.item, target); // 实时提示已展示，这里确认合并
  } else if (d.over === 'group' && d.overKey) {
    const g = allRailGroups.value.find((x) => x.key === d.overKey);
    if (g && !g.items.some((x) => x.id === d.item.id)) {
      // 临时组：分配一个递增 groupIndex；真实组：沿用组 index/title
      const gi = g.groupIndex ?? nextGroupIndex();
      await saveGrouping(d.item.id, gi, g.title);
    }
  }
}
/** 合并两道题（与「合并所选」同一流程：拼接预览 → 确认） */
async function mergeTwo(src: OcrItem, target: OcrItem) {
  if (src.id === target.id) return;
  if (src.mergedFromImagePath || target.mergedFromImagePath) return ElMessage.warning('合并题不可再次合并，请先「撤销合并」');
  if (src.mergedIntoId || target.mergedIntoId) return ElMessage.warning('该题已被合并，请先「撤销合并」');
  if (src.status === 'APPROVED' || target.status === 'APPROVED') return ElMessage.warning('已入库的题不可合并，请到题库操作');
  const [a, b] = [src, target].sort((x, y) => itemPageOrder(x) - itemPageOrder(y));
  mergingItems.value = true;
  try {
    const { blob, dataUrl } = await buildMergedImage(a, b);
    mergeDialog.value = { a, b, blob, preview: dataUrl, aLabel: itemLabel(a), bLabel: itemLabel(b) };
    mergeDialogVisible.value = true;
  } catch (e) {
    ElMessage.error((e as Error).message || '拼图失败');
  } finally {
    mergingItems.value = false;
  }
}
/** 拖动落位：保存分组（即存，同步刷新） */
async function saveGrouping(itemId: string, groupIndex: number | null, groupTitle: string) {
  try {
    await ingestApi.review(itemId, { groupIndex, groupTitle });
    await refreshActive();
  } catch {
    /* 拦截器已提示 */
  }
}
/** 下一个可用的 groupIndex（用于临时组落位） */
function nextGroupIndex(): number {
  const nums = reviewGroups.value.map((g) => g.groupIndex).filter((x): x is number => x != null);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

// 临时大题组（本地状态，拖入题目后才真正写入题上的 groupIndex/groupTitle）
const tempGroups = ref<{ key: string; title: string }[]>([]);
function addRailGroup() {
  tempGroups.value.push({ key: `tmp-${Date.now()}`, title: `新增大题 ${tempGroups.value.length + 1}` });
}
/** 面板渲染组 = 真实组 + 临时组 */
const allRailGroups = computed(() => [
  ...reviewGroups.value,
  ...tempGroups.value.map((t) => ({ key: t.key, groupIndex: null as number | null, title: t.title, items: [] as OcrItem[] })),
]);

/** 删除大题组：组内小题归入「未分组」（groupIndex/groupTitle 清空） */
async function removeRailGroup(g: { key: string; groupIndex: number | null; title: string; items: OcrItem[] }) {
  const count = g.items.length;
  try {
    await ElMessageBox.confirm(
      count ? `删除大题「${g.title}」？组内 ${count} 道小题将归入「未分组」。` : `删除空大题「${g.title}」？`,
      '删除大题组',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  if (g.key.startsWith('tmp-')) {
    tempGroups.value = tempGroups.value.filter((t) => t.key !== g.key);
    return;
  }
  try {
    await Promise.all(g.items.map((it) => ingestApi.review(it.id, { groupIndex: null, groupTitle: null })));
    ElMessage.success(`已删除「${g.title}」，${count} 道小题归入未分组`);
    await refreshActive();
  } catch {
    /* 拦截器已提示 */
  }
}
/** 拖拽实时提示文案 */
const railDragTip = computed(() => {
  const d = railDragState.value;
  if (!d) return '';
  if (d.over === 'item') return '拖动到此处合并题目';
  if (d.over === 'group') {
    const g = allRailGroups.value.find((x) => x.key === d.overKey);
    return g ? `→ 移入「${g.title}」` : '松开取消';
  }
  return '松开取消';
});

/** 组内排序：与相邻题交换 number（即存，同步刷新） */
async function moveRailItem(it: OcrItem, dir: -1 | 1) {
  const g = reviewGroups.value.find((x) => x.items.some((y) => y.id === it.id));
  if (!g) return;
  const arr = g.items;
  const idx = arr.findIndex((x) => x.id === it.id);
  const j = idx + dir;
  if (j < 0 || j >= arr.length) return;
  const a = arr[idx];
  const b = arr[j];
  const aNum = a.number ?? a.index;
  const bNum = b.number ?? b.index;
  try {
    await Promise.all([
      ingestApi.review(a.id, { number: bNum }),
      ingestApi.review(b.id, { number: aNum }),
    ]);
    await refreshActive();
  } catch {
    /* 拦截器已提示 */
  }
}

/** 大题标题点击编辑 */
const editingGroupKey = ref<string>('');
const editingGroupTitle = ref('');
function startEditGroupTitle(g: { key: string; title: string }) {
  editingGroupKey.value = g.key;
  editingGroupTitle.value = g.title;
}
async function saveGroupTitle(g: { key: string }) {
  const title = editingGroupTitle.value.trim();
  editingGroupKey.value = '';
  if (!title) return;
  // 临时组：仅改本地标题
  if (g.key.startsWith('tmp-')) {
    const tg = tempGroups.value.find((t) => t.key === g.key);
    if (tg) tg.title = title;
    return;
  }
  const groupItems = reviewGroups.value.find((x) => x.key === g.key)?.items || [];
  if (!groupItems.length) return;
  try {
    await Promise.all(groupItems.map((it) => ingestApi.review(it.id, { groupTitle: title })));
    await refreshActive();
  } catch {
    /* 拦截器已提示 */
  }
}
/** 面板上的撤销合并（主项） */
async function unmergeFromRail(item: OcrItem) {
  try {
    await ElMessageBox.confirm('撤销合并：拆回合并前的两道题？', '撤销合并', { type: 'warning' });
    await ingestApi.unmergeItem(item.id);
    ElMessage.success('已撤销合并');
    await refreshActive();
  } catch {
    /* cancel */
  }
}

interface ItemEdit {
  type: QuestionType | '';
  stem: string;
  difficulty: number;
  analysis: string;
  subjectId: string;
  paperName: string;
  tagIds: string[];
  knowledgePointIds: string[];
  // 分值：大题分值（识别时题干剥离，人工可填/改）
  score: number;
  // 题型相关的内容字段（审阅台按题型联动显示）
  options: QuestionOption[]; // 选择题选项
  answer: string; // 选择/判断答案
  blanks: string[]; // 填空每空答案
  rubric: string; // 简答/论述评分要点
  passage: string; // 阅读理解材料（AI 识别保存，审阅台不展示输入框，仅透传）
  subQuestions: SubQuestionEdit[]; // 阅读理解/材料题小题
  images: { cropId: string; label?: string; fromOcr?: boolean }[]; // 题内图片（「+图片」添加 + OCR 识别合并，入库写 content.images）
}
const editForms = reactive<Record<string, ItemEdit>>({});
const savingItemId = ref<string | null>(null);

// 审阅台原图：按 pageId 缓存页面图片，并在图上按 bbox 高亮对应题区，方便对照修改
const pageImageMap = reactive<Record<string, string>>({});
function bboxStyle(item: OcrItem): Record<string, string> {
  const b = (item.bbox as number[]) || [];
  if (b.length !== 4) return {};
  const [x0, y0, x1, y1] = b;
  return {
    left: `${x0 * 100}%`,
    top: `${y0 * 100}%`,
    width: `${(x1 - x0) * 100}%`,
    height: `${(y1 - y0) * 100}%`,
  };
}
async function loadReviewImages() {
  for (const u of Object.values(pageImageMap)) URL.revokeObjectURL(u);
  for (const k of Object.keys(pageImageMap)) delete pageImageMap[k];
  const pages = (activeJob.value?.pages || []) as any[];
  await Promise.all(
    pages.map(async (p) => {
      try {
        pageImageMap[p.id] = await ingestApi.pageImageUrl(p.id);
      } catch {
        /* 忽略缺图 */
      }
    }),
  );
}
function closeReview() {
  for (const u of Object.values(pageImageMap)) URL.revokeObjectURL(u);
  for (const k of Object.keys(pageImageMap)) delete pageImageMap[k];
  for (const u of Object.values(mergedImageMap)) URL.revokeObjectURL(u);
  for (const k of Object.keys(mergedImageMap)) delete mergedImageMap[k];
  stopPolling();
  stopDetectProgress();
}

function initEdit(item: OcrItem): ItemEdit {
  const c = (item.content as QuestionContent | null) ?? {};
  const opts = Array.isArray(c.options) ? c.options : [];
  const subs = Array.isArray(c.subQuestions) ? c.subQuestions : [];
  // 题图：content.images（「+图片」/「采用已框题图」添加的部分）。
  // OCR 识别的 figures 不再自动并入，改为在审阅台「+图片 → 采用已框题图」里按需采用，避免重复展示。
  const userImgs = Array.isArray(c.images)
    ? (c.images as any[]).filter((im) => im?.cropId).map((im) => ({ cropId: im.cropId, label: im.label }))
    : [];
  return {
    type: (item.type as QuestionType) ?? '',
    stem: item.stem ?? '',
    difficulty: item.difficulty ?? 3,
    analysis: item.analysis ?? '',
    subjectId: item.subjectId ?? uploadSubjectId.value ?? '',
    paperName: item.paperName ?? '',
    tagIds: [],
    knowledgePointIds: [],
    score: typeof (c as any).score === 'number' ? (c as any).score : 0,
    options: opts.map((o) => ({ key: o.key, text: o.text ?? '', correct: o.correct })),
    answer: typeof c.answer === 'string' ? c.answer : '',
    blanks: Array.isArray(c.blanks) ? (c.blanks as string[]) : [],
    rubric: typeof c.rubric === 'string' ? c.rubric : '',
    passage: typeof c.passage === 'string' ? c.passage : '',
    images: userImgs,
    subQuestions: subs.map((s: any) => ({
      type: (s.type as QuestionType) ?? '',
      stem: s.stem ?? '',
      options: (Array.isArray(s.options) ? s.options : []).map((o: any) => ({ key: o.key, text: o.text ?? '', correct: o.correct })),
      answer: typeof s.answer === 'string' ? s.answer : '',
    })),
  };
}

async function openReview(job: IngestJob) {
  try {
    const full = (await ingestApi.get(job.id)) as unknown as IngestJob;
    syncFromJob(full);
    // 统一操作区初始值（文件类型 / 名称 / 学科 / 作业本）
    sourceType.value = (full.sourceType as 'PAPER' | 'WORKBOOK') || 'PAPER';
    sourceName.value = full.fileName || '';
    unifiedSubjectId.value = full.subjectId || uploadSubjectId.value || undefined;
    selectedWorkbookId.value = sourceType.value === 'WORKBOOK' && full.workbookId ? full.workbookId : '';
    selectedWorkbookSectionId.value =
      sourceType.value === 'WORKBOOK' && full.workbookSectionId ? full.workbookSectionId : '';
    if (sourceType.value === 'WORKBOOK') {
      await loadWorkbookOptions();
      await loadReviewWbTree();
    }
    if (uploadSubjectId.value) {
      suggestions.value = (await ingestApi.suggestions(uploadSubjectId.value)) as unknown as KnowledgePointSuggestion[];
    }
    drawer.value = true;
    await loadReviewImages();
    startPolling();
  } catch {
    /* 拦截器已提示 */
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

// 按当前题型把编辑表单组装成 content（与后端 normalizeContent 的结构对齐）
function buildContent(f: ItemEdit): Record<string, any> {
  const content: Record<string, any> = {};
  const t = f.type as QuestionType | '';
  // 大题分值（识别时题干已剥离「（X分）」；人工可填可改，AI 解题时按分值给得分点）
  if (typeof f.score === 'number' && Number.isFinite(f.score) && f.score > 0) {
    content.score = f.score;
  }
  if (t === 'SINGLE_CHOICE' || t === 'MULTIPLE_CHOICE') {
    content.options = f.options.map((o) => ({ key: o.key, text: o.text, correct: !!o.correct }));
    const answer = optionsToAnswer(f.options);
    if (answer) content.answer = answer;
  } else if (t === 'TRUE_FALSE') {
    if (f.answer) content.answer = f.answer;
  } else if (t === 'FILL_BLANK') {
    if (f.blanks.length) content.blanks = f.blanks.filter((b) => b !== '');
  } else if (t === 'SHORT_ANSWER' || t === 'ESSAY') {
    // 简答/论述：大题含多个小问时存 subQuestions；否则单题 rubric
    if (f.subQuestions.length) {
      content.subQuestions = subQuestionsToContent(f.subQuestions);
    } else if (f.rubric) {
      content.rubric = f.rubric;
    }
  } else if (t === 'READING_COMPREHENSION') {
    // 阅读理解：材料 passage 由 AI 识别保存（透传，审阅台不编辑）；小题含用户勾选的正确项/答案
    content.passage = f.passage;
    content.subQuestions = subQuestionsToContent(f.subQuestions);
  } else if (t === 'MATERIAL') {
    content.subQuestions = subQuestionsToContent(f.subQuestions);
  }
  // 题内图片（「+图片」添加，任意题型）
  if (f.images?.length) {
    content.images = f.images.map((im) => ({ cropId: im.cropId, label: im.label || '题内图片' }));
  } else {
    delete content.images;
  }
  return content;
}

// 把编辑表单持久化到后端（含题型 + 内容），返回是否成功；供 save / approve / 重新识别前调用
async function persistItem(item: OcrItem): Promise<boolean> {
  const f = editForms[item.id];
  if (!f) return false;
  savingItemId.value = item.id;
  try {
    await ingestApi.review(item.id, {
      type: f.type || undefined,
      stem: f.stem,
      difficulty: f.difficulty,
      analysis: f.analysis,
      paperName: f.paperName,
      subjectId: f.subjectId || undefined,
      content: buildContent(f),
    });
    return true;
  } catch {
    /* 拦截器已提示 */
    return false;
  } finally {
    savingItemId.value = null;
  }
}

// 切换题型时立即持久化题型（识别按后端已保存的 item.type 作为约束），其余字段保持 dirty 保护
async function onTypeChange(item: OcrItem) {
  const f = editForms[item.id];
  if (!f) return;
  markDirty(item.id);
  try {
    await ingestApi.review(item.id, { type: f.type || undefined });
  } catch {
    /* 拦截器已提示 */
  }
}

async function saveItem(item: OcrItem) {
  const ok = await persistItem(item);
  if (!ok) return;
  ElMessage.success('已保存修改');
  clearDirty(item.id);
  refreshActive();
}

async function approveItem(item: OcrItem) {
  const f = editForms[item.id];
  if (!f) return;
  if (!f.paperName || !f.paperName.trim()) {
    ElMessage.warning('请先填写该题「所属试卷」再入库（题库中每道题都必须归属到一张试卷）');
    return;
  }
  // 先持久化未保存的编辑（含 content），确保入库内容最新
  const ok = await persistItem(item);
  if (!ok) return;
  try {
    const res = await ingestApi.approve(item.id, {
      subjectId: f.subjectId || undefined,
      tagIds: f.tagIds,
      knowledgePointIds: f.knowledgePointIds,
      paperName: f.paperName,
    }) as unknown as any;
    if (res?.duplicateWarning) {
      // 入库不自动合并：疑似重复仅提示，照常录入（合并到「题目查重」页人工处理）
      ElMessage.warning('已入库。注意：该题疑似与题库中已有题目重复，可在「题目查重」页人工核对合并');
    } else {
      ElMessage.success('已批准入库。解答可在题库题目详情页点「生成 AI 解答」统一生成');
    }
    clearDirty(item.id);
    refreshActive();
  } catch {
    /* 拦截器已提示 */
  }
}

// ---------------- 批量操作（统一操作区 / 一键保存 / 一键入库） ----------------
const sourceType = ref<'PAPER' | 'WORKBOOK'>('PAPER');
const sourceName = ref('');
const unifiedSubjectId = ref<string>();
/** 作业本模式：指向已有作业本实体（章节树在作业本视图内管理，审阅台只选本/选已有） */
const workbookOptions = ref<Workbook[]>([]);
const selectedWorkbookId = ref<string>('');
/** 审阅台选作业本后，可继续选到具体章节（支持章节/子章节）；审批时按章节全路径写题目 sourcePath */
const selectedWorkbookSectionId = ref<string>('');
const reviewWbTree = ref<WorkbookSectionNode[]>([]);
const reviewWbTreeLoading = ref(false);

/** 当前所选章节的全路径标签（作业本名不计入，仅章节层级） */
const reviewSectionPathLabel = computed(() => {
  if (!selectedWorkbookSectionId.value) return '作业本根（不指定章节）';
  const map = new Map<string, WorkbookSectionNode>();
  const walk = (nodes: WorkbookSectionNode[]) => {
    for (const n of nodes) {
      map.set(n.id, n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(reviewWbTree.value);
  const names: string[] = [];
  let cur: WorkbookSectionNode | undefined = map.get(selectedWorkbookSectionId.value);
  while (cur) {
    names.unshift(cur.name);
    cur = cur.parentId ? map.get(cur.parentId) : undefined;
  }
  return names.length ? names.join(' / ') : '作业本根（不指定章节）';
});
const batchSaving = ref(false);
const batchApproving = ref(false);
const applyingMeta = ref(false);

async function loadWorkbookOptions() {
  try {
    workbookOptions.value = (await workbookApi.list()) as unknown as Workbook[];
  } catch {
    workbookOptions.value = [];
  }
}

/** 加载当前所选作业本的章节树（用于审阅台选章节/子章节） */
async function loadReviewWbTree() {
  if (!selectedWorkbookId.value) {
    reviewWbTree.value = [];
    return;
  }
  reviewWbTreeLoading.value = true;
  try {
    const w = (await workbookApi.get(selectedWorkbookId.value)) as unknown as Workbook & { tree?: WorkbookSectionNode[] };
    reviewWbTree.value = w.tree || [];
  } catch {
    reviewWbTree.value = [];
  } finally {
    reviewWbTreeLoading.value = false;
  }
}

/** 切换作业本：清空已选章节并重新加载章节树 */
function onWorkbookSelectChange(val: string) {
  selectedWorkbookSectionId.value = '';
  if (val) loadReviewWbTree();
  else reviewWbTree.value = [];
}

/** 审阅台内新建章节（根）或子章节（指定 parentId）；章节/子章节都可在审阅台新建，但作业本本身不可新建 */
async function reviewCreateSection(parentId?: string) {
  if (!selectedWorkbookId.value) return;
  try {
    const { value } = await ElMessageBox.prompt(parentId ? '输入子章节名称' : '输入章节名称', parentId ? '新建子章节' : '新建章节', {
      inputValidator: (v) => (v && v.trim() ? true : '名称不能为空'),
    });
    await workbookApi.createSection(selectedWorkbookId.value, { name: value.trim(), parentId });
    ElMessage.success(parentId ? '已新建子章节' : '已新建章节');
    await loadReviewWbTree();
  } catch (e: any) {
    if (e !== 'cancel' && e?.action !== 'cancel') {
      /* 拦截器已提示 */
    }
  }
}

async function reviewRenameSection(node: WorkbookSectionNode) {
  if (!selectedWorkbookId.value) return;
  try {
    const { value } = await ElMessageBox.prompt('修改章节名称', '重命名', {
      inputValue: node.name,
      inputValidator: (v) => (v && v.trim() ? true : '名称不能为空'),
    });
    await workbookApi.updateSection(selectedWorkbookId.value, node.id, { name: value.trim() });
    ElMessage.success('已重命名');
    await loadReviewWbTree();
  } catch (e: any) {
    if (e !== 'cancel' && e?.action !== 'cancel') {
      /* 拦截器已提示 */
    }
  }
}

async function reviewRemoveSection(node: WorkbookSectionNode) {
  if (!selectedWorkbookId.value) return;
  try {
    await ElMessageBox.confirm(`删除章节「${node.name}」？其下题目将移回作业本根。`, '删除章节', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
    await workbookApi.removeSection(selectedWorkbookId.value, node.id);
    ElMessage.success('已删除章节');
    if (selectedWorkbookSectionId.value === node.id) selectedWorkbookSectionId.value = '';
    await loadReviewWbTree();
  } catch (e: any) {
    if (e !== 'cancel' && e?.action !== 'cancel') {
      /* 拦截器已提示 */
    }
  }
}

function onSourceTypeChange(val: string | number | boolean | undefined) {
  if (val === 'WORKBOOK') {
    selectedWorkbookId.value = '';
    selectedWorkbookSectionId.value = '';
    loadWorkbookOptions();
  }
}

async function applyUnified() {
  if (!activeJob.value) return;
  applyingMeta.value = true;
  try {
    const payload: {
      sourceType: 'PAPER' | 'WORKBOOK';
      subjectId?: string;
      name?: string;
      workbookId?: string;
      workbookSectionId?: string | null;
    } = {
      sourceType: sourceType.value,
      subjectId: unifiedSubjectId.value || undefined,
    };
    if (sourceType.value === 'PAPER') {
      payload.name = sourceName.value.trim() || undefined;
    } else if (sourceType.value === 'WORKBOOK') {
      // 选「是作业本」时指向已有作业本 + 具体章节；章节为空则落到作业本根
      payload.workbookId = selectedWorkbookId.value || undefined;
      payload.workbookSectionId = selectedWorkbookSectionId.value || null;
    }
    const updated = (await ingestApi.updateMeta(activeJob.value.id, payload)) as unknown as IngestJob;
    // 同步到本地编辑表单（统一名称/学科）
    for (const it of updated.items || []) {
      if (it.status === 'APPROVED' || it.status === 'REJECTED') continue;
      const f = editForms[it.id];
      if (!f) continue;
      if (sourceType.value === 'PAPER') {
        const nm = sourceName.value.trim();
        if (nm) f.paperName = nm;
      }
      if (unifiedSubjectId.value) f.subjectId = unifiedSubjectId.value;
      markDirty(it.id);
    }
    ElMessage.success('已应用统一设置');
  } catch {
    /* 拦截器已提示 */
  } finally {
    applyingMeta.value = false;
  }
}

async function batchSave() {
  const items = (activeJob.value?.items || []).filter((i) => i.status !== 'APPROVED' && i.status !== 'REJECTED');
  if (!items.length) return ElMessage.warning('没有可保存的题目');
  batchSaving.value = true;
  try {
    let ok = 0;
    for (const it of items) {
      if (await persistItem(it)) ok++;
    }
    ElMessage.success(`已保存 ${ok}/${items.length} 道题`);
  } finally {
    batchSaving.value = false;
  }
}

async function batchApprove() {
  const items = (activeJob.value?.items || []).filter((i) => i.status !== 'APPROVED' && i.status !== 'REJECTED');
  if (!items.length) return ElMessage.warning('没有可入库的题目');
  batchApproving.value = true;
  try {
    let ok = 0;
    let warned = 0;
    let failed = 0;
    for (const it of items) {
      // 先保存未保存的编辑，再入库（入库后端仅提示疑似重复，不自动合并）
      const saved = await persistItem(it);
      if (!saved) {
        failed++;
        continue;
      }
      if (!editForms[it.id].paperName?.trim()) {
        failed++;
        continue;
      }
      try {
        const res = (await ingestApi.approve(it.id, {
          subjectId: editForms[it.id].subjectId || undefined,
          tagIds: editForms[it.id].tagIds,
          knowledgePointIds: editForms[it.id].knowledgePointIds,
          paperName: editForms[it.id].paperName,
        })) as unknown as any;
        if (res?.duplicateWarning) warned++;
        else ok++;
      } catch {
        failed++;
      }
    }
    const parts = [`入库 ${ok} 道`];
    if (warned) parts.push(`疑似重复（已照常录入）${warned} 道`);
    if (failed) parts.push(`失败 ${failed} 道`);
    ElMessage.success(parts.join('，'));
    refreshActive();
  } finally {
    batchApproving.value = false;
  }
}

// ---------------- 内容编辑器辅助（填空增删） ----------------
const isChoiceType = (t: string) => t === 'SINGLE_CHOICE' || t === 'MULTIPLE_CHOICE';
function addBlank(item: OcrItem) {
  const f = editForms[item.id];
  if (!f) return;
  f.blanks.push('');
  markDirty(item.id);
}
function removeBlank(item: OcrItem, idx: number) {
  const f = editForms[item.id];
  if (!f) return;
  f.blanks.splice(idx, 1);
  markDirty(item.id);
}

async function rejectItem(item: OcrItem) {
  try {
    await ElMessageBox.confirm('拒绝该题？将从审阅台移出。', '确认', { type: 'warning' });
    await ingestApi.reject(item.id);
    ElMessage.success('已拒绝');
    clearDirty(item.id);
    refreshActive();
  } catch {
    /* cancel */
  }
}

// 标记某题有未保存的本地编辑：自动刷新轮询会跳过该项，避免覆盖用户正在改的内容
const dirtyItems = reactive<Record<string, boolean>>({});
function markDirty(itemId: string) {
  dirtyItems[itemId] = true;
}
function clearDirty(itemId: string) {
  delete dirtyItems[itemId];
}

// 用服务端最新任务同步审阅台本地状态。dirtyItems 中的题保留用户未保存编辑，其余用服务端识别结果覆盖
// （让重新识别 / 后台变化的结果立即可见，解决「状态不刷新、被旧值覆盖成空白」）
function syncFromJob(job: IngestJob) {
  activeJob.value = job;
  for (const it of job.items || []) {
    // 跳过用户正在手改的题；其余直接用服务端最新结果重建编辑表单（含题型与内容），
    // 使「重新识别 / 后台变化」后的题型与内容都即时可见，而不是只更新题干等个别字段。
    if (dirtyItems[it.id]) continue;
    editForms[it.id] = initEdit(it);
  }
}

// 自动刷新：审阅台打开期间每 4s 拉一次服务端状态，识别 / 重识别完成或状态变化即时反映，无需手动刷新页面
let pollTimer: ReturnType<typeof setInterval> | null = null;
const POLL_MS = 4000;
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (!activeJob.value || !drawer.value) return;
    try {
      const job = (await ingestApi.get(activeJob.value.id)) as unknown as IngestJob;
      syncFromJob(job);
    } catch {
      /* 忽略轮询瞬时错误 */
    }
  }, POLL_MS);
}
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function refreshActive() {
  if (!activeJob.value) return;
  const job = (await ingestApi.get(activeJob.value.id)) as unknown as IngestJob;
  syncFromJob(job);
  loadJobs();
}

async function approveSug(s: KnowledgePointSuggestion) {
  try {
    await ingestApi.approveSuggestion(s.id);
    ElMessage.success(`已采纳知识点「${s.name}」`);
    refreshActive();
  } catch {
    /* 拦截器已提示 */
  }
}
async function rejectSug(s: KnowledgePointSuggestion) {
  try {
    await ingestApi.rejectSuggestion(s.id);
    refreshActive();
  } catch {
    /* 拦截器已提示 */
  }
}

// ---------------- 合并跨页截断题 ----------------
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}
/** 按 bbox 裁出两页各自题区图并上下拼接（宽度取较大者，水平居中） */
async function buildMergedImage(a: OcrItem, b: OcrItem): Promise<{ blob: Blob; dataUrl: string }> {
  const srcA = pageImageMap[a.pageId ?? ''] ?? '';
  const srcB = pageImageMap[b.pageId ?? ''] ?? '';
  if (!srcA || !srcB) throw new Error('缺少页面原图');
  const [imgA, imgB] = await Promise.all([loadImage(srcA), loadImage(srcB)]);
  const crop = (img: HTMLImageElement, bbox?: number[] | null) => {
    const bb = bbox && bbox.length === 4 ? bbox : [0, 0, 1, 1];
    return {
      x: Math.round(bb[0] * img.naturalWidth),
      y: Math.round(bb[1] * img.naturalHeight),
      w: Math.round((bb[2] - bb[0]) * img.naturalWidth),
      h: Math.round((bb[3] - bb[1]) * img.naturalHeight),
    };
  };
  const cA = crop(imgA, a.bbox);
  const cB = crop(imgB, b.bbox);
  const W = Math.max(cA.w, cB.w, 1);
  const H = Math.max(cA.h, 1) + Math.max(cB.h, 1);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持 Canvas');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(imgA, cA.x, cA.y, cA.w, cA.h, Math.round((W - cA.w) / 2), 0, cA.w, cA.h);
  ctx.drawImage(imgB, cB.x, cB.y, cB.w, cB.h, Math.round((W - cB.w) / 2), cA.h, cB.w, cB.h);
  const dataUrl = canvas.toDataURL('image/png');
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('拼图失败'))), 'image/png');
  });
  return { blob, dataUrl };
}
/** 排序用：页序 × 100 + bbox 顶部 y（保证合并时"上半截"在前） */
function itemPageOrder(item: OcrItem): number {
  const pages = activeJob.value?.pages || [];
  const pi = Math.max(0, pages.findIndex((p) => p.id === item.pageId));
  const b = (item.bbox as number[]) || [0, 0, 1, 1];
  return (pi + 1) * 100 + (b[1] ?? 0);
}
function itemLabel(item: OcrItem): string {
  const pages = activeJob.value?.pages || [];
  const pi = Math.max(0, pages.findIndex((p) => p.id === item.pageId)) + 1;
  return `第 ${pi} 页 · 题 ${item.number ?? item.index}`;
}
/** 交换上下：重新拼图并更新预览 */
async function swapMergeOrder() {
  const d = mergeDialog.value;
  if (!d) return;
  mergingItems.value = true;
  try {
    const { blob, dataUrl } = await buildMergedImage(d.b, d.a);
    d.preview = dataUrl;
    d.blob = blob;
    [d.a, d.b] = [d.b, d.a];
    d.aLabel = itemLabel(d.a);
    d.bLabel = itemLabel(d.b);
  } catch (e) {
    ElMessage.error((e as Error).message || '拼图失败');
  } finally {
    mergingItems.value = false;
  }
}
/** 确认合并：按弹窗中的上下顺序（a 在上、b 在下）提交 */
async function confirmMerge() {
  const d = mergeDialog.value;
  if (!d) return;
  mergingItems.value = true;
  try {
    if (mergedImageMap[d.a.id]) URL.revokeObjectURL(mergedImageMap[d.a.id]);
    mergedImageMap[d.a.id] = URL.createObjectURL(d.blob);
    await ingestApi.mergeItems(d.a.id, d.b.id, d.blob);
    await refreshActive();
    mergeDialogVisible.value = false;
    mergeDialog.value = null;
    ElMessage.success('已合并为一道题（图片已上下拼接），可点「重新识别」识别整题');
  } catch {
    /* 拦截器已提示 */
  } finally {
    mergingItems.value = false;
  }
}
/** 回退合并：拆回合并前的两道题 */
async function unmergeItem(item: OcrItem) {
  try {
    await ElMessageBox.confirm('将把这道合并题拆回合并前的两道题（恢复各自原图与选框），确定回退？', '回退合并', {
      type: 'warning',
      confirmButtonText: '回退',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await ingestApi.unmergeItem(item.id);
    if (mergedImageMap[item.id]) {
      URL.revokeObjectURL(mergedImageMap[item.id]);
      delete mergedImageMap[item.id];
    }
    await refreshActive();
    ElMessage.success('已回退合并，恢复为两道题');
  } catch {
    /* 拦截器已提示 */
  }
}

// ---------------- AI 框选进度条 ----------------
function startDetectProgress(jobId: string) {
  stopDetectProgress();
  detectProgress.value = { done: 0, total: 0, pageIndex: 0 };
  detectProgressTimer = setInterval(async () => {
    try {
      detectProgress.value = (await ingestApi.detectProgress(jobId)) as any;
    } catch {
      /* 忽略瞬时错误 */
    }
  }, 1500);
}
function stopDetectProgress() {
  if (detectProgressTimer !== null) {
    clearInterval(detectProgressTimer);
    detectProgressTimer = null;
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
  await loadJobs();
  // AI 工作进度跳转：?jobId= 直接定位并打开该任务的审阅台
  const route = useRoute();
  const jobId = route.query.jobId;
  if (typeof jobId === 'string' && jobId) {
    try {
      const job = (await ingestApi.get(jobId)) as unknown as IngestJob;
      if (job) {
        await openReview(job);
        await nextTick(() => {
          const el = document.querySelector('.review-dialog');
          el?.scrollIntoView?.({ behavior: 'smooth' });
        });
      }
    } catch {
      /* 任务可能已删除 */
    }
  }
});

onUnmounted(stopPolling);
</script>

<template>
  <div class="ingest">
    <div class="ingest__toolbar">
      <div class="ingest__upload">
        <el-upload
          drag
          :auto-upload="false"
          :show-file-list="true"
          accept="image/*,application/pdf"
          :limit="1"
          @change="onFileChange"
        >
          <div class="ingest__upload-inner">
            <el-icon :size="28"><Upload /></el-icon>
            <div>拖入试题图片 / PDF，或点击选择</div>
          </div>
        </el-upload>
        <div class="ingest__upload-actions">
          <el-form label-position="top">
            <el-form-item label="识别学科（用于 AI 标知识点）">
              <el-tree-select
                v-model="uploadSubjectId"
                :data="subjects"
                :props="SUBJECT_TREE_PROPS"
                check-strictly
                clearable
                placeholder="选填，如 数学"
                style="width: 240px"
              />
            </el-form-item>
          </el-form>
          <el-button type="primary" :loading="uploading" :disabled="!uploadFile" @click="doUpload">
            上传
          </el-button>
        </div>
      </div>
      <div class="ingest__pipeline">
        <div class="pipe">
          <template v-for="(s, i) in pipelineSteps" :key="i">
            <span class="pipe__step">
              <i class="pipe__dot">{{ i + 1 }}</i>{{ s }}
            </span>
            <span v-if="i < pipelineSteps.length - 1" class="pipe__sep" aria-hidden="true"></span>
          </template>
        </div>
      </div>
    </div>

    <el-divider />

    <div class="ingest__head">
      <h2 class="ingest__title">录入任务</h2>
      <el-button :icon="'Refresh'" :loading="loading" @click="loadJobs">刷新</el-button>
    </div>

    <el-table :data="jobs" stripe border v-loading="loading">
      <el-table-column prop="fileName" label="文件名" min-width="200" />
      <el-table-column prop="fileType" label="类型" width="68" />
      <el-table-column label="状态" width="88">
        <template #default="{ row }">
          <el-tag>{{ INGEST_JOB_STATUS_LABEL[(row as IngestJob).status] }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="题目数" width="72">
        <template #default="{ row }">{{ (row as IngestJob)._count?.items ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="创建时间" min-width="148">
        <template #default="{ row }">{{ formatDateTime((row as IngestJob).createdAt) }}</template>
      </el-table-column>
      <el-table-column label="进度" width="150">
        <template #default="{ row }">
          <div class="prog">
            <div class="prog__bar">
              <span
                v-for="(s, i) in pipelineSteps"
                :key="i"
                class="prog__seg"
                :class="{ 'is-active': i <= stepActive(row as IngestJob), 'is-cur': i === stepActive(row as IngestJob) }"
              />
            </div>
            <div class="prog__txt">
              {{ stepActive(row as IngestJob) + 1 }}/{{ pipelineSteps.length }}
              {{ pipelineSteps[stepActive(row as IngestJob)] }}
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="232" fixed="right" class-name="ingest__ops">
        <template #default="{ row }">
          <el-button text type="primary" size="small" @click="openBboxEditor(row as IngestJob)">框选题目</el-button>
          <el-button
            text
            type="success"
            size="small"
            :loading="recognizingId === (row as IngestJob).id"
            :disabled="!canRecognize(row as IngestJob)"
            @click="doRecognize(row as IngestJob)"
          >识别题目</el-button>
          <el-button
            text
            type="primary"
            size="small"
            :disabled="!(row as IngestJob)._count?.items"
            @click="openReview(row as IngestJob)"
          >审阅台</el-button>
          <!-- 删除：叉号图标按钮，置于操作列最后 -->
          <el-button
            text
            type="danger"
            size="small"
            :icon="'Close'"
            :aria-label="`删除 ${(row as IngestJob).fileName}`"
            title="删除任务"
            @click="removeJob(row as IngestJob)"
          />
        </template>
      </el-table-column>
      <template #empty>暂无录入任务，先上传一份试卷图片吧</template>
    </el-table>

    <div class="ingest__pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        @current-change="loadJobs"
        @size-change="loadJobs"
      />
    </div>

    <!-- 框选编辑器（步骤 2/3） -->
    <el-dialog v-model="bboxVisible" title="框选题目编辑器" width="92%" top="3vh" @close="closeBbox">
      <div v-if="bboxJob" class="bbox">
        <div class="bbox__bar">
          <div class="bbox__left">
            <el-button
              size="small"
              type="primary"
              :loading="detectingId === bboxJob?.id"
              :disabled="!['UPLOADED', 'SEGMENTING', 'REVIEWING'].includes(bboxJob?.status)"
              @click="reDetect"
            >AI 框选题目</el-button>
            <span class="bbox__hint">用 AI 自动检测题目区域（可重复框选）</span>
          </div>
          <div class="bbox__actions">
            <el-button size="small" @click="prevPage" :disabled="bboxPageIndex === 0">上一页</el-button>
            <el-button
              size="small"
              @click="nextPage"
              :disabled="bboxPageIndex >= (bboxJob.pages?.length || 1) - 1"
            >下一页</el-button>
            <el-button
              size="small"
              :type="addBoxMode === 'question' ? 'success' : 'default'"
              @click="addBoxMode = addBoxMode === 'question' ? null : 'question'"
            >
              {{ addBoxMode === 'question' ? '拖拽添加题目框…' : '添加题目框' }}
            </el-button>
            <el-button
              size="small"
              :type="addBoxMode === 'figure' ? 'warning' : 'default'"
              @click="addBoxMode = addBoxMode === 'figure' ? null : 'figure'"
            >
              {{ addBoxMode === 'figure' ? '拖拽添加图片框…' : '添加图片框' }}
            </el-button>
            <span class="bbox__zoom">
              缩放
              <el-slider
                v-model="bboxScale"
                :min="40"
                :max="150"
                :step="5"
                :show-tooltip="false"
                style="width: 110px; display: inline-block; margin: 0 6px;"
                class="bbox__zoom-slider"
              />
              {{ bboxScale }}%
            </span>
          </div>
        </div>
        <p class="bbox__tip">
          拖动已有框可移动，拖右下角可缩放；点「添加题目框」拖出题目区域，点「添加图片框」拖出独立图片区域（与题目解耦，审阅台可分别采用）。改动自动保存（删除请点框上 ✕）。
        </p>
        <div v-if="detectingId === bboxJob?.id && detectProgress && detectProgress.total > 0" class="bbox__progress">
          <el-progress
            :percentage="detectPercent"
            :stroke-width="4"
            :format="() => detectLabel"
            style="font-size: 11px;"
          />
        </div>
        <div class="bbox__stage">
          <div ref="imgWrap" class="bbox__wrap" :style="{ width: bboxScale + '%', maxWidth: '100%' }" @pointerdown="onWrapDown">
            <img v-if="pageImageUrl" :src="pageImageUrl" class="bbox__img" draggable="false" />
            <div
              v-for="b in localBoxes"
              :key="b.id"
              class="bbox__box"
              :data-id="b.id"
              :class="{
                'is-selected': dragState?.id === b.id,
                'is-readonly': b.mergedMain || b.merged,
                'is-approved': b.approved,
                'bbox__box--fig-over': figureDrag?.hoverBoxId === b.id,
              }"
              :style="{
                left: b.bbox[0] * 100 + '%',
                top: b.bbox[1] * 100 + '%',
                width: (b.bbox[2] - b.bbox[0]) * 100 + '%',
                height: (b.bbox[3] - b.bbox[1]) * 100 + '%',
              }"
              @pointerdown="onBoxDown($event, b)"
            >
              <span class="bbox__box-index">{{ b.number ?? b.index }}</span>
              <span v-if="!b.mergedMain && !b.merged && !b.approved" class="bbox__box-del" @pointerdown.stop @click.stop="deleteBox(b)">✕</span>
              <span v-if="b.mergedMain || b.merged" class="bbox__box-badge bbox__box-badge--merged">已合并</span>
              <span v-if="b.approved" class="bbox__box-badge bbox__box-badge--approved">已入库</span>
              <span class="bbox__box-type">{{ b.type ? QUESTION_TYPE_LABEL[b.type as QuestionType] : '未识别' }}</span>
              <span v-if="!b.mergedMain && !b.merged" class="bbox__box-handle" @pointerdown="onResizeDown($event, b)"></span>
              <span v-if="savingBoxId === b.id" class="bbox__box-saving">保存中…</span>
            </div>
            <!-- 题内图片框：imgWrap 直接子级（全页坐标），可移动/缩放/删除/拖到另一题改归属 -->
            <template v-for="b in localBoxes" :key="'figs-' + b.id">
              <div
                v-for="(f, fi) in b.figures || []"
                :key="'f' + b.id + '-' + fi"
                class="bbox__fig"
                :class="{ 'bbox__fig--over': figureDrag?.hoverBoxId === b.id }"
                :style="{
                  left: f.bbox[0] * 100 + '%',
                  top: f.bbox[1] * 100 + '%',
                  width: (f.bbox[2] - f.bbox[0]) * 100 + '%',
                  height: (f.bbox[3] - f.bbox[1]) * 100 + '%',
                }"
                @pointerdown.stop="onFigureDown($event, b, fi)"
              >
                <span class="bbox__fig-label">
                  {{ figureDrag?.hoverBoxId && figureDrag.boxId === b.id ? `→ 归属 第 ${hoverBoxIndex(figureDrag.hoverBoxId)} 题` : `🖼 图${fi + 1} · 第${b.index}题` }}
                </span>
                <span class="bbox__fig-del" @pointerdown.stop @click.stop="deleteFigure(b, fi)">✕</span>
                <span class="bbox__fig-handle" @pointerdown.stop="onFigureResizeDown($event, b, fi)"></span>
              </div>
            </template>
            <!-- 页面级图片框（与题目框解耦）：独立的可移动/缩放/删除框，不归属于任何题目 -->
            <div
              v-for="(f, fi) in localPageFigures"
              :key="'pfig-' + fi"
              class="bbox__fig bbox__fig--page"
              :style="{
                left: f.bbox[0] * 100 + '%',
                top: f.bbox[1] * 100 + '%',
                width: (f.bbox[2] - f.bbox[0]) * 100 + '%',
                height: (f.bbox[3] - f.bbox[1]) * 100 + '%',
              }"
              @pointerdown.stop="onPageFigureDown($event, fi)"
            >
              <span class="bbox__fig-label">🖼 页图{{ fi + 1 }}</span>
              <span class="bbox__fig-del" @pointerdown.stop @click.stop="deletePageFigure(fi)">✕</span>
              <span class="bbox__fig-handle" @pointerdown.stop="onPageFigureResizeDown($event, fi)"></span>
            </div>
            <div
              v-if="drawing"
              class="bbox__draw"
              :class="{ 'bbox__draw--fig': addBoxMode === 'figure' }"
              :style="{
                left: Math.min(drawing.x0, drawing.x1) * 100 + '%',
                top: Math.min(drawing.y0, drawing.y1) * 100 + '%',
                width: Math.abs(drawing.x1 - drawing.x0) * 100 + '%',
                height: Math.abs(drawing.y1 - drawing.y0) * 100 + '%',
              }"
            ></div>
          </div>
        </div>
      </div>
    </el-dialog>

    <!-- 审阅台（步骤 4/5）：原图对照 + 紧凑编辑表单 -->
    <el-dialog
      v-model="drawer"
      :title="`审阅台 · ${(activeJob?.fileName) || ''}`"
      width="95%"
      top="3vh"
      class="review-dialog"
      @close="closeReview"
    >
      <div v-if="activeJob" class="review">
        <div class="review__header">
          <div class="review__meta">
            <span class="review__meta-label">来源信息</span>
            <el-radio-group v-model="sourceType" size="small" @change="onSourceTypeChange">
              <el-radio-button value="PAPER">试卷</el-radio-button>
              <el-radio-button value="WORKBOOK">作业本</el-radio-button>
            </el-radio-group>
            <el-input
              v-if="sourceType === 'PAPER'"
              v-model="sourceName"
              size="small"
              placeholder="试卷名称"
              style="width: 180px"
              clearable
              @keyup.enter="applyUnified"
            />
            <el-select
              v-else
              v-model="selectedWorkbookId"
              size="small"
              placeholder="选择已有作业本"
              filterable
              style="width: 220px"
              @visible-change="(v: boolean) => v && loadWorkbookOptions()"
              @change="onWorkbookSelectChange"
            >
              <el-option v-for="wb in workbookOptions" :key="wb.id" :label="wb.name" :value="wb.id" />
              <template #empty><span class="review__meta-hint">题库「按作业本」中先新建作业本</span></template>
            </el-select>
            <el-tree-select
              v-model="unifiedSubjectId"
              :data="subjects"
              :props="SUBJECT_TREE_PROPS"
              check-strictly
              clearable
              size="small"
              placeholder="统一学科"
              style="width: 150px"
            />
            <el-button size="small" type="primary" :loading="applyingMeta" @click="applyUnified">应用</el-button>
            <span class="review__meta-divider" />
            <div class="review__stats">
              <span class="stat stat--pending">待审阅 <b>{{ reviewStats.pending }}</b></span>
              <span class="stat stat--approved">已入库 <b>{{ reviewStats.approved }}</b></span>
              <span class="stat stat--rejected">已拒绝 <b>{{ reviewStats.rejected }}</b></span>
              <span v-if="reviewStats.merged" class="stat stat--merged">合并题 <b>{{ reviewStats.merged }}</b></span>
            </div>
          </div>
          <ol class="review__flow" aria-label="审阅操作动线">
            <li><i>1</i>对照原图核对</li>
            <li><i>2</i>修正题型 / 答案</li>
            <li><i>3</i>右栏拖拽分组</li>
            <li><i>4</i>一键入库</li>
          </ol>
        </div>
        <div class="review__body">
        <div class="review__main">
        <div class="review__ops">
          <div class="review__ops-actions">
            <el-button size="small" type="warning" plain :loading="recognizingId === activeJob.id" @click="doRecognize(activeJob)">
              {{ jobRecognized ? '重新识别全部' : '全部识别' }}
            </el-button>
            <el-button size="small" :loading="batchSaving" @click="batchSave">一键保存</el-button>
            <el-button size="small" type="success" :loading="batchApproving" @click="batchApprove">一键入库</el-button>
          </div>
          <span class="review__ops-tip">逐题检测重复并合并到来源试卷；跨页截断题请拖右栏题号合并</span>
        </div>
        <!-- 审阅台选作业本 + 选章节（章节/子章节可在审阅台新建；作业本本身在题库「按作业本」新建） -->
        <div v-if="sourceType === 'WORKBOOK'" class="review__sections">
          <div class="review__sections-bar">
            <span class="review__toolbar-label">所属作业本：</span>
            <span v-if="selectedWorkbookId" class="review__wb-name">{{ workbookOptions.find((w) => w.id === selectedWorkbookId)?.name || '—' }}</span>
            <span v-else class="review__meta-hint">未选择作业本</span>
            <el-button
              v-if="selectedWorkbookId"
              size="small"
              text
              type="primary"
              :icon="'Plus'"
              @click="reviewCreateSection()"
            >新建章节</el-button>
          </div>
          <template v-if="selectedWorkbookId">
            <div class="review__sections-tree" v-loading="reviewWbTreeLoading">
              <div class="review__sections-hint">选择具体章节（可新建章节 / 子章节）：</div>
              <div
                class="review__section-root"
                :class="{ 'is-selected': selectedWorkbookSectionId === '' }"
                @click="selectedWorkbookSectionId = ''"
              >作业本根（不指定章节）</div>
              <WbSectionTree
                v-if="reviewWbTree.length"
                :nodes="reviewWbTree"
                :selected-id="selectedWorkbookSectionId"
                @select="(id) => (selectedWorkbookSectionId = id)"
                @add-child="reviewCreateSection"
                @rename="reviewRenameSection"
                @remove="reviewRemoveSection"
              />
              <el-empty v-else-if="!reviewWbTreeLoading" description="暂无章节，点「新建章节」添加" :image-size="40" />
            </div>
            <div v-if="selectedWorkbookSectionId" class="review__sections-sel">
              已选章节：<b>{{ reviewSectionPathLabel }}</b>
            </div>
          </template>
        </div>
        <div v-if="activeJob.pages?.[0]?.paperName" class="review__paper">
          本页识别试卷：<b>{{ activeJob.pages[0].paperName }}</b>（可逐题覆盖）
        </div>

        <div class="review__items">
          <div v-for="g in groupedItems" :key="g.key" class="review__group">
            <div class="review__group-title">{{ g.groupTitle }}<span class="review__group-count">（{{ g.items.length }} 题）</span></div>
            <el-card
              v-for="item in g.items"
              :key="item.id"
              shadow="never"
              class="review__item"
            >
            <div class="review__item-head">
              <span class="review__idx">{{ item.number ?? item.index }}</span>
              <el-tag size="small">{{ item.type ? QUESTION_TYPE_LABEL[item.type as QuestionType] : '未识别' }}</el-tag>
              <el-tag v-if="item.mergedFromImagePath" size="small" type="primary" effect="plain">已合并</el-tag>
              <el-button
                size="small"
                :loading="rerecognizingIds.has(item.id)"
                :disabled="item.status === 'APPROVED'"
                @click="reRecognizeItem(item)"
              >{{ jobRecognized ? '重新识别' : '识别' }}</el-button>
              <el-button
                v-if="item.mergedFromImagePath"
                size="small"
                type="warning"
                plain
                @click="unmergeItem(item)"
              >撤销合并</el-button>
              <el-tag size="small" :type="item.status === 'APPROVED' ? 'success' : item.status === 'REJECTED' ? 'info' : 'warning'">
                {{ OCR_ITEM_STATUS_LABEL[item.status] }}
              </el-tag>
              <span v-if="item.confidence" class="review__conf">置信度 {{ Math.round(item.confidence * 100) }}%</span>
            </div>
            <div class="review__row">
              <!-- 左：来源原图 + 题区高亮（合并题两图两框，AI 识别仍用拼接图） -->
              <div class="review__img-col">
                <!-- 合并主项：两页原图 + 各自原始框 -->
                <template v-if="item.mergedFromImagePath">
                  <div class="review__img">
                    <img
                      v-if="pageImageMap[item.pageId ?? '']"
                      :src="pageImageMap[item.pageId ?? '']"
                      class="review__img-el"
                    />
                    <div v-else class="review__img-empty">无主项原图</div>
                    <div v-if="item.mergedFromBbox" class="review__hl" :style="bboxStyleFrom(item.mergedFromBbox as any)">
                      <span class="review__hl-idx">上 · {{ item.number ?? item.index }}</span>
                    </div>
                    <!-- 题图框位置（框选编辑器里框选的题图，黄色虚线；与题目框在同一原图上） -->
                    <div
                      v-for="(fig, fi) in (item.figures as any[]) || []"
                      :key="'fig-hl-' + fi"
                      class="review__hl review__hl--fig"
                      :style="bboxStyleFrom(fig?.bbox)"
                    >
                      <span class="review__hl-idx">图{{ fi + 1 }}</span>
                    </div>
                  </div>
                  <div v-if="mergedChild(item)" class="review__img">
                    <img
                      v-if="pageImageMap[mergedChild(item)!.pageId ?? '']"
                      :src="pageImageMap[mergedChild(item)!.pageId ?? '']"
                      class="review__img-el"
                    />
                    <div v-else class="review__img-empty">无下页原图</div>
                    <div v-if="mergedChild(item)!.bbox" class="review__hl review__hl--down" :style="bboxStyle(mergedChild(item)!)">
                      <span class="review__hl-idx">下 · {{ mergedChild(item)!.number ?? mergedChild(item)!.index }}</span>
                    </div>
                  </div>
                  <div class="review__hl-merged">已合并：两图两框供核对（AI 识别用拼接图，可「重新识别」）</div>
                </template>
                <!-- 被合并项：不再单独渲染（已并入主项） -->
                <template v-else-if="item.mergedIntoId">
                  <div class="review__img-empty">已并入主项（两图两框见主项）</div>
                </template>
                <!-- 普通题：单页原图 + 框高亮 -->
                <template v-else>
                  <div class="review__img">
                    <img
                      v-if="pageImageMap[item.pageId ?? '']"
                      :src="pageImageMap[item.pageId ?? '']"
                      class="review__img-el"
                    />
                    <div v-else class="review__img-empty">无来源原图</div>
                    <div v-if="item.bbox" class="review__hl" :style="bboxStyle(item)">
                      <span class="review__hl-idx">{{ item.number ?? item.index }}</span>
                    </div>
                    <!-- 题图框位置（框选编辑器里框选的题图，黄色虚线；与题目框在同一原图上） -->
                    <div
                      v-for="(fig, fi) in (item.figures as any[]) || []"
                      :key="'fig-hl-' + fi"
                      class="review__hl review__hl--fig"
                      :style="bboxStyleFrom(fig?.bbox)"
                    >
                      <span class="review__hl-idx">图{{ fi + 1 }}</span>
                    </div>
                  </div>
                </template>

              </div>

              <!-- 右：编辑表单 -->
              <div class="review__fields">
              <el-form label-position="top" class="review__form">
                  <!-- 题型 | 得分 | 学科：同一排 -->
                  <div class="review__meta-row">
                    <el-form-item label="题型" class="review__meta-item review__meta-item--type">
                      <el-select v-model="editForms[item.id]!.type" placeholder="选择题型" style="width: 100%" @change="onTypeChange(item)">
                        <el-option v-for="o in QUESTION_TYPE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="得分" class="review__meta-item review__meta-item--score">
                      <el-input-number
                        v-model="editForms[item.id]!.score"
                        :min="0"
                        :max="100"
                        :step="1"
                        :controls="false"
                        size="default"
                        style="width: 100%"
                        @change="markDirty(item.id)"
                      />
                    </el-form-item>
                    <el-form-item label="学科" class="review__meta-item review__meta-item--subject">
                      <el-tree-select
                        v-model="editForms[item.id]!.subjectId"
                        :data="subjects"
                        :props="SUBJECT_TREE_PROPS"
                        check-strictly
                        clearable
                        placeholder="选填"
                        style="width: 100%"
                        @change="ensureKpTree(editForms[item.id]!.subjectId); markDirty(item.id)"
                      />
                    </el-form-item>
                  </div>

                  <el-form-item label="题干">
                    <el-input
                      v-model="editForms[item.id]!.stem"
                      type="textarea"
                      :rows="3"
                      placeholder="在此输入题干，公式用 $...$ 包裹"
                      @input="markDirty(item.id)"
                    />
                    <MathText :value="editForms[item.id]!.stem" :inline="false" />
                    <QuestionImageEditor
                      :model-value="editForms[item.id]?.images ?? []"
                      :figure-pool="figurePool(item)"
                      :figure-page-id="item.pageId ?? undefined"
                      @update:model-value="(v) => onReviewImagesChange(item, v)"
                    />
                  </el-form-item>

                  <!-- 选择题：选项列表 + 答案 -->
                  <template v-if="isChoiceType(editForms[item.id]!.type)">
                    <el-form-item label="选项（勾选正确项）">
                      <OptionsEditor :model-value="editForms[item.id]!.options" :single="editForms[item.id]!.type === 'SINGLE_CHOICE'" @change="markDirty(item.id)" />
                    </el-form-item>
                  </template>

                  <!-- 判断题：答案 -->
                  <el-form-item v-else-if="editForms[item.id]!.type === 'TRUE_FALSE'" label="答案">
                    <el-select v-model="editForms[item.id]!.answer" placeholder="正确答案" clearable style="width: 100%" @change="markDirty(item.id)">
                      <el-option label="正确" value="T" />
                      <el-option label="错误" value="F" />
                    </el-select>
                  </el-form-item>

                  <!-- 填空题：每空答案 -->
                  <el-form-item v-else-if="editForms[item.id]!.type === 'FILL_BLANK'" label="参考答案（每空一条）">
                    <div class="rv-blanks">
                      <div v-for="(b, bi) in editForms[item.id]!.blanks" :key="bi" class="rv-blank">
                        <el-input v-model="editForms[item.id]!.blanks[bi]" :placeholder="`空 ${bi + 1}`" @input="markDirty(item.id)" />
                        <el-button text type="danger" size="small" :icon="'Close'" @click="removeBlank(item, bi)" />
                      </div>
                      <el-button size="small" @click="addBlank(item)">+ 空</el-button>
                    </div>
                  </el-form-item>

                  <!-- 简答/论述：大题含多个小问时逐个填小题干+答案；小题题型可改（第一次 AI 自动识别） -->
                  <el-form-item
                    v-else-if="editForms[item.id]!.type === 'SHORT_ANSWER' || editForms[item.id]!.type === 'ESSAY'"
                    label="小题干（含多个小问时逐个填写，答案可选；题型可改）"
                  >
                    <SubQuestionsEditor :model-value="editForms[item.id]!.subQuestions" show-type @change="markDirty(item.id)" />
                  </el-form-item>

                  <!-- 阅读理解大题：小题编辑（题型 + 题干 + 选项 + 正确项勾选）；材料/大题题干不填 -->
                  <el-form-item v-if="editForms[item.id]!.type === 'READING_COMPREHENSION'" label="小题（选择类可勾选正确项）">
                    <SubQuestionsEditor :model-value="editForms[item.id]!.subQuestions" show-type @change="markDirty(item.id)" />
                  </el-form-item>

                  <!-- 材料题：小题列表（题干 + 参考答案） -->
                  <el-form-item v-else-if="editForms[item.id]!.type === 'MATERIAL'" label="小题列表">
                    <SubQuestionsEditor :model-value="editForms[item.id]!.subQuestions" :show-type="false" @change="markDirty(item.id)" />
                  </el-form-item>

                  <el-form-item label="难度">
                    <el-rate v-model="editForms[item.id]!.difficulty" @change="markDirty(item.id)" />
                  </el-form-item>
                  <el-form-item label="所属试卷（题目来源）">
                    <el-input v-model="editForms[item.id]!.paperName" placeholder="如 2023 高考数学全国卷 I" @input="markDirty(item.id)" />
                  </el-form-item>
                  <el-form-item label="知识点">
                    <el-tree-select
                      v-model="editForms[item.id]!.knowledgePointIds"
                      :data="kpTrees[editForms[item.id]!.subjectId] || []"
                      :props="KP_TREE_PROPS"
                      check-strictly
                      multiple
                      clearable
                      placeholder="选填"
                      style="width: 100%"
                      @change="markDirty(item.id)"
                    />
                  </el-form-item>
                  <el-form-item label="标签">
                    <el-select
                      v-model="editForms[item.id]!.tagIds"
                      multiple
                      filterable
                      allow-create
                      default-first-option
                      placeholder="选填"
                      style="width: 100%"
                      @change="markDirty(item.id)"
                    >
                      <el-option v-for="t in tags" :key="t.id" :label="t.name" :value="t.id" />
                    </el-select>
                  </el-form-item>
                </el-form>

                <div class="review__actions">
                  <el-button size="small" :loading="savingItemId === item.id" @click="saveItem(item)">保存</el-button>
                  <el-button size="small" type="success" :disabled="item.status === 'APPROVED'" @click="approveItem(item)">批准入题</el-button>
                  <el-button size="small" type="danger" :disabled="item.status === 'REJECTED' || item.status === 'APPROVED'" @click="rejectItem(item)">拒绝</el-button>
                </div>
              </div>
            </div>
            </el-card>
          </div>
        </div>
        </div><!-- /review__main -->

        <!-- 右侧：大题与题号面板（拖拽分组 / 拖拽合并 / 大题标题编辑，即存同步刷新） -->
        <aside class="review__rail">
          <div class="rail__head">
            <div class="rail__head-title">
              <span>大题与题号</span>
              <span class="rail__count">{{ (activeJob?.items || []).filter((i) => !i.mergedIntoId).length }} 题</span>
            </div>
            <p class="rail__hint">按住题号拖动：移到「大题组」= 换大题；拖到另一题上 = 合并。</p>
            <ul class="rail__legend">
              <li><i class="dot dot--normal"></i>普通题</li>
              <li><i class="dot dot--merged"></i>已合并</li>
              <li><i class="dot dot--approved"></i>已入库</li>
            </ul>
          </div>
          <div class="rail__groups">
            <div
              v-for="g in allRailGroups"
              :key="g.key"
              class="rail__group"
              :class="{ 'rail__group--over': railDragState?.over === 'group' && railDragState.overKey === g.key }"
              :data-key="g.key"
            >
              <div class="rail__group-title" @click="startEditGroupTitle(g)">
                <template v-if="editingGroupKey !== g.key">
                  <span class="rail__group-name">{{ g.title }}</span>
                  <span class="rail__group-count">{{ g.items.length }} 题</span>
                  <span class="rail__group-edit">✎</span>
                </template>
                <el-input
                  v-else
                  v-model="editingGroupTitle"
                  size="small"
                  placeholder="大题标题"
                  @blur="saveGroupTitle(g)"
                  @keyup.enter="saveGroupTitle(g)"
                  @keyup.esc="editingGroupKey = ''"
                />
                <el-button
                  v-if="g.key !== '__none__'"
                  text
                  type="danger"
                  size="small"
                  class="rail__group-del"
                  @click.stop="removeRailGroup(g)"
                >删组</el-button>
              </div>
              <div class="rail__items">
                <div
                  v-for="it in g.items"
                  :key="it.id"
                  class="rail__item"
                  :class="{
                    'rail__item--merged': !!it.mergedFromImagePath,
                    'rail__item--over': railDragState?.over === 'item' && railDragState.overKey === it.id,
                  }"
                  :data-id="it.id"
                  @pointerdown="onRailItemDown($event, it)"
                >
                  <span class="rail__item-no">{{ it.number ?? it.index }}</span>
                  <span class="rail__item-arrows">
                    <i class="rail__arrow" title="上移（组内排序）" @pointerdown.stop @click.stop="moveRailItem(it, -1)">↑</i>
                    <i class="rail__arrow" title="下移（组内排序）" @pointerdown.stop @click.stop="moveRailItem(it, 1)">↓</i>
                  </span>
                  <el-button
                    v-if="it.mergedFromImagePath"
                    text
                    type="warning"
                    size="small"
                    class="rail__item-unmerge"
                    @click.stop="unmergeFromRail(it)"
                  >撤销合并</el-button>
                  <span v-else-if="it.status === 'APPROVED'" class="rail__item-ok">已入库</span>
                </div>
              </div>
            </div>
          </div>
          <el-button text type="primary" size="small" :icon="'Plus'" class="rail__add" @click="addRailGroup">
            新增大题组
          </el-button>
          <!-- 拖拽浮动 chip + 实时提示 -->
          <div
            v-if="railDragState"
            class="rail__float"
            :style="{ left: railDragState.x + 'px', top: railDragState.y + 'px' }"
          >
            <span class="rail__float-no">{{ railDragState.item.number ?? railDragState.item.index }}</span>
            <span class="rail__float-tip">{{ railDragTip }}</span>
          </div>
        </aside>
        </div><!-- /review__body -->

        <el-collapse v-model="sugOpen" class="review__sug-collapse">
          <el-collapse-item name="sug">
            <template #title>
              <span class="review__sug-title">AI 知识点建议（待确认）<span class="review__sug-count">{{ suggestions.length }}</span></span>
            </template>
            <div v-if="suggestions.length" class="review__sug">
              <el-tag
                v-for="s in suggestions"
                :key="s.id"
                class="review__sug-tag"
                effect="plain"
              >
                {{ s.name }}
                <el-button text type="success" size="small" @click="approveSug(s)">采纳</el-button>
                <el-button text type="info" size="small" @click="rejectSug(s)">忽略</el-button>
              </el-tag>
            </div>
            <el-empty v-else description="暂无建议" :image-size="48" />
          </el-collapse-item>
        </el-collapse>
      </div>
    </el-dialog>

    <!-- 合并预览：检查上下拼接顺序，可交换后再确认 -->
    <el-dialog v-model="mergeDialogVisible" title="合并跨页题目（检查拼接顺序）" width="460px" :close-on-click-modal="false">
      <div v-if="mergeDialog" class="merge-dlg">
        <img :src="mergeDialog.preview" class="merge-dlg__img" />
        <div class="merge-dlg__meta">
          <span class="merge-dlg__pos">上方</span> {{ mergeDialog.aLabel }}
          <span class="merge-dlg__pos merge-dlg__pos--down">下方</span> {{ mergeDialog.bLabel }}
        </div>
        <div class="merge-dlg__tip">
          检查拼接顺序是否正确：上半截应在上面。不对就点「⇅ 交换上下」；确认后合并为一道题（合并后可随时「撤销合并」）。
        </div>
      </div>
      <template #footer>
        <el-button :loading="mergingItems" @click="swapMergeOrder">⇅ 交换上下</el-button>
        <el-button @click="mergeDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="mergingItems" @click="confirmMerge">确认合并</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.ingest { display: flex; flex-direction: column; gap: var(--space-4); }
/* 顶部操作栏：统一卡片面板，与全局设计语言一致 */
.ingest__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
  align-items: stretch;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  padding: var(--space-5) var(--space-6);
}
/* 上传操作区 */
.ingest__upload { display: flex; gap: var(--space-4); align-items: stretch; }
.ingest__upload :deep(.el-upload-dragger) {
  padding: 16px;
  border-radius: var(--radius-sm);
}
.ingest__upload-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--c-text-muted);
  font-size: 13px;
}
.ingest__upload-actions {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-3);
}
/* 流程说明区：与上传区用竖线分隔 */
.ingest__pipeline {
  flex: 1;
  min-width: 320px;
  display: flex;
  align-items: center;
  padding-left: var(--space-6);
  border-left: 1px solid var(--c-border);
  overflow-x: auto;
}
/* 流程步骤：圆点序号 + 连接线，分层清晰 */
.pipe {
  display: flex;
  align-items: center;
  gap: 0;
  font-size: 12px;
  color: var(--c-text-muted);
  white-space: nowrap;
}
.pipe__step {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--c-text);
}
.pipe__dot {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--c-primary-50);
  color: var(--c-primary);
  border: 1px solid var(--c-primary-100);
  font-style: normal;
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.pipe__sep {
  flex: 0 0 auto;
  width: 28px;
  height: 1px;
  margin: 0 8px;
  background: var(--c-border-strong);
}
.ingest__head { display: flex; justify-content: space-between; align-items: center; }
.ingest__title { font-size: 18px; font-weight: 700; margin: 0; }
.ingest__pager { display: flex; justify-content: flex-end; }
/* 操作列按钮不换行 */
.ingest__ops :deep(.cell) { white-space: nowrap; display: flex; align-items: center; gap: 2px; flex-wrap: nowrap; }
.ingest__ops :deep(.el-button + .el-button) { margin-left: 0; }

/* 进度列：紧凑分段进度条，避免图标被截断 */
.prog { display: flex; flex-direction: column; gap: 4px; }
.prog__bar { display: flex; gap: 2px; }
.prog__seg { flex: 1; height: 6px; border-radius: 3px; background: var(--c-border, #ebeef5); }
.prog__seg.is-active { background: var(--el-color-primary); }
.prog__seg.is-cur { background: var(--el-color-success); }
.prog__txt { font-size: 11px; color: var(--c-text-subtle); white-space: nowrap; }

.review { display: flex; flex-direction: column; gap: var(--space-4); }

/* 头部：试卷信息 + 状态概览 + 操作动线（四步引导） */
.review__header {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap;
  background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4); box-shadow: var(--shadow-sm);
}
.review__meta { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.review__meta-label { font-size: 13px; font-weight: 700; color: var(--c-text-muted); }
.review__meta-divider { width: 1px; height: 22px; background: var(--c-border); margin: 0 2px; }
.review__stats { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.stat { font-size: 12px; color: var(--c-text-muted); background: var(--c-surface-2); border-radius: var(--radius-pill); padding: 2px 10px; white-space: nowrap; }
.stat b { color: var(--c-text); margin-left: 2px; }
.stat--pending b { color: var(--c-warning, #d97706); }
.stat--approved b { color: var(--c-success, #16a34a); }
.stat--rejected b { color: var(--c-danger, #dc2626); }
.stat--merged b { color: var(--c-primary); }
/* 操作动线：四步横向步骤，教育化引导老师按序操作 */
.review__flow { display: flex; align-items: center; gap: 4px; margin: 0; padding: 0; list-style: none; flex-wrap: wrap; }
.review__flow li { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--c-text-muted); }
.review__flow li i {
  flex: 0 0 auto; width: 18px; height: 18px; border-radius: 50%;
  background: var(--c-primary-50, #eef2ff); color: var(--c-primary); border: 1px solid var(--c-primary-100, #e0e7ff);
  font-style: normal; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center;
}
.review__flow li:not(:last-child)::after { content: '→'; color: var(--c-border-strong, #cbd5e1); margin: 0 4px; }

/* 主区动作栏：识别 / 保存 / 入库集中，主次分明 */
.review__ops {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap;
  padding: var(--space-2) var(--space-3); background: var(--c-bg-soft, #f8fafc);
  border: 1px solid var(--c-border); border-radius: var(--radius-md);
}
.review__ops-actions { display: flex; align-items: center; gap: var(--space-2); }
.review__ops-tip { font-size: 12px; color: var(--c-text-subtle); }

/* 题型 | 得分 | 学科：同一排（题卡内） */
.review__meta-row { display: flex; gap: var(--space-3); align-items: flex-start; flex-wrap: wrap; }
.review__meta-item { flex: 1 1 0; min-width: 0; margin-bottom: 0; }
.review__meta-item--type { flex-basis: 150px; max-width: 180px; }
.review__meta-item--score { flex-basis: 90px; max-width: 110px; }
.review__meta-item--subject { flex-basis: 180px; max-width: 220px; }
.review__meta-item :deep(.el-form-item__label) { padding-bottom: 2px; }
.review__sections { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2) var(--space-3); background: var(--c-surface-2); border-radius: var(--radius-md); }
.review__sections-bar { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.review__sections-tree { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; max-height: 220px; overflow: auto; border: 1px solid var(--c-border); border-radius: 6px; padding: var(--space-2); background: var(--c-surface); }
.review__sections-hint { font-size: 12px; color: var(--c-text-subtle); margin-bottom: 2px; }
.review__section-root { padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; color: var(--c-text); transition: background var(--motion-base) var(--ease-out); }
.review__section-root:hover { background: var(--c-surface-2); }
.review__section-root.is-selected { background: var(--c-primary-50, #eef2ff); box-shadow: inset 2px 0 0 var(--c-primary); font-weight: 600; }
.review__sections-sel { font-size: 12px; color: var(--c-text-muted); margin-top: 2px; }
.review__sections-sel b { color: var(--c-primary); }
.review__wb-name { font-weight: 600; color: var(--c-primary); }
.review__meta-hint { font-size: 12px; color: var(--c-text-subtle); }
.review__toolbar-label { font-size: 13px; font-weight: 600; color: var(--c-text-muted); }
.review__paper { background: var(--c-bg-soft); padding: 8px 12px; border-radius: 6px; font-size: 13px; }
.review__items { display: flex; flex-direction: column; gap: var(--space-3); }
.review__group { display: flex; flex-direction: column; gap: var(--space-2); }
.review__group-title { font-size: 14px; font-weight: 700; color: var(--c-text); padding: 4px 0 4px 10px; border-left: 3px solid var(--c-primary); }
.review__group-count { font-size: 12px; font-weight: 400; color: var(--c-text-subtle); margin-left: 6px; }
/* 审阅台左右分栏：主区题卡 + 右侧题号面板 */
.review__body { display: flex; gap: var(--space-4); align-items: flex-start; }
.review__main { flex: 1; min-width: 0; }
/* 右侧「大题与题号」面板 */
.review__rail {
  flex: 0 0 280px; width: 280px; max-height: 78vh; overflow: auto; position: sticky; top: 0;
  border: 1px solid var(--c-border); border-radius: var(--radius-md);
  background: var(--c-surface); padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-2);
  box-shadow: var(--shadow-sm);
}
.rail__head { display: flex; flex-direction: column; gap: 6px; padding-bottom: 6px; border-bottom: 1px solid var(--c-border); }
.rail__head-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--c-text); }
.rail__count { font-size: 11px; font-weight: 400; color: var(--c-text-subtle); }
.rail__hint { font-size: 11px; font-weight: 400; color: var(--c-text-subtle); margin: 0; line-height: 1.5; }
.rail__legend { display: flex; gap: 10px; margin: 0; padding: 0; list-style: none; flex-wrap: wrap; }
.rail__legend li { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--c-text-muted); }
.rail__legend .dot { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
.dot--normal { background: var(--c-primary); }
.dot--merged { background: var(--c-primary); box-shadow: 0 0 0 1px #fff inset; border: 1px dashed var(--c-primary); }
.dot--approved { background: var(--c-success, #16a34a); }
.rail__groups { display: flex; flex-direction: column; gap: var(--space-2); }
.rail__group { border: 1px dashed var(--c-border); border-radius: 6px; padding: 6px; transition: border-color .15s, background .15s; }
.rail__group--over { border-color: var(--c-primary); background: rgba(79, 110, 247, 0.06); }
.rail__group-title { display: flex; align-items: center; gap: 6px; cursor: text; padding: 2px 0; }
.rail__group-name { font-size: 12px; font-weight: 700; color: var(--c-text); }
.rail__group-count { font-size: 11px; color: var(--c-text-subtle); }
.rail__group-edit { font-size: 11px; color: var(--c-primary); opacity: 0; transition: opacity .15s; }
.rail__group-title:hover .rail__group-edit { opacity: 1; }
.rail__group-del { padding: 0 2px; }
.rail__items { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.rail__item {
  display: flex; align-items: center; gap: 6px; padding: 4px 8px; cursor: grab;
  border: 1px solid var(--c-border); border-radius: 4px; background: var(--c-bg-soft, #f5f7fa);
  font-size: 12px; touch-action: none; user-select: none; transition: border-color .15s, background .15s;
}
.rail__item:active { cursor: grabbing; }
.rail__item--merged { border-style: dashed; border-color: var(--c-primary); }
.rail__item--over { border-color: #f56c6c; background: rgba(245, 108, 108, 0.12); }
.rail__item-no { flex: 0 0 auto; font-weight: 700; color: var(--c-primary); min-width: 16px; text-align: right; }
/* 组内排序箭头：悬停显示 */
.rail__item-arrows { display: inline-flex; gap: 2px; opacity: 0; transition: opacity .15s; }
.rail__item:hover .rail__item-arrows { opacity: 1; }
.rail__arrow { font-style: normal; cursor: pointer; color: var(--c-primary); font-size: 13px; line-height: 1; padding: 0 3px; border-radius: 3px; }
.rail__arrow:hover { background: rgba(79, 110, 247, 0.12); }
.rail__item-unmerge { padding: 0 4px; }
.rail__item-ok { font-size: 10px; color: #67c23a; flex: 0 0 auto; }
.rail__add { align-self: flex-start; }
/* 拖拽浮动 chip：跟随鼠标 + 实时意图提示 */
.rail__float {
  position: fixed; z-index: 3000; pointer-events: none; display: flex; align-items: center; gap: 6px;
  background: var(--c-primary); color: #fff; border-radius: 6px; padding: 4px 10px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2); transform: translate(-6px, -26px); font-size: 12px; white-space: nowrap;
}
.rail__float-no { font-weight: 700; }
.rail__float-tip { font-size: 11px; opacity: .95; }
/* 每张题卡：左原图（带题区高亮）+ 右编辑表单，紧凑左右对照 */
.review__item :deep(.el-card__body) { padding: var(--space-3); }
.review__row { display: flex; gap: var(--space-4); align-items: flex-start; }
.review__img {
  position: relative; flex: 0 1 auto; min-width: 200px; max-width: 280px; align-self: flex-start;
  border: 1px solid var(--c-border); border-radius: var(--radius-md);
  background: var(--c-bg-subtle, #f5f7fa); overflow: hidden; line-height: 0;
  box-sizing: content-box;
  /* 高度不写死：由图片自身（width:100%;height:auto）撑开，题框按百分比定位 → 长图零漂移；宽度由左栏控制保持紧凑 */
}
.review__img-el { display: block; width: 100%; height: auto; }
.review__img-empty {
  display: flex; align-items: center; justify-content: center; min-height: 160px;
  color: var(--c-text-subtle); font-size: 12px; line-height: 1.4; padding: 12px;
}
/* 题区高亮框：用 outline 而非 border，避免 border 占用布局尺寸导致与 img 漂移 */
.review__hl { position: absolute; outline: 2px solid #f56c6c; background: rgba(245, 108, 108, 0.15); pointer-events: none; }
.review__hl--down { outline-color: #409eff; background: rgba(64, 158, 255, 0.12); }
.review__hl--fig { outline-style: dashed; outline-color: #e6a23c; background: rgba(230, 162, 60, 0.12); }
.review__hl--fig .review__hl-idx { background: #e6a23c; }
.review__hl-idx {
  position: absolute; top: -20px; left: 0; font-size: 11px; font-weight: 700;
  color: #fff; background: #f56c6c; padding: 0 6px; border-radius: 3px; line-height: 16px;
}
.review__hl--down .review__hl-idx { background: #409eff; }
.review__hl-merged {
  font-size: 11px; font-weight: 600; color: #fff; background: var(--c-primary, #4f46e5);
  padding: 2px 8px; border-radius: 4px; line-height: 16px; margin-top: 4px; display: inline-block;
}
/* 审阅台左栏：多图纵向排列 */
.review__img-col { flex: 0 0 220px; width: 220px; max-width: 220px; min-width: 0; display: flex; flex-direction: column; gap: var(--space-2); align-self: flex-start; }
/* 题内图片缩略 */
.review__figs { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 12px; }
.review__figs-label { color: var(--c-text-muted); font-weight: 600; }
.review__fig { width: 56px; height: 56px; object-fit: cover; border: 1px solid var(--c-border); border-radius: 6px; cursor: zoom-in; }
.review__figs-empty { color: var(--c-text-subtle); font-size: 12px; }
/* 分值输入：图片下方 */
.review__score { display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: var(--c-surface-2, #f5f7fa); border-radius: 6px; }
.review__score-label { font-size: 12px; font-weight: 600; color: var(--c-text-muted); }
.review__score-tip { font-size: 11px; color: var(--c-text-subtle); }
/* AI 框选进度条 */
.bbox__progress { padding: 0 4px 4px; }

/* 合并预览弹窗 */
.merge-dlg { display: flex; flex-direction: column; gap: var(--space-3); }
.merge-dlg__img { max-width: 100%; max-height: 46vh; border: 1px solid var(--c-border, #cbd5e1); border-radius: 6px; }
.merge-dlg__meta { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--c-text-muted); flex-wrap: wrap; }
.merge-dlg__pos { font-size: 11px; font-weight: 700; color: #fff; background: var(--c-primary, #4f46e5); padding: 1px 8px; border-radius: 10px; }
.merge-dlg__pos--down { background: #67c23a; }
.merge-dlg__tip { font-size: 12px; color: var(--c-text-subtle); }
.review__fields { flex: 1; min-width: 300px; }
.review__item-head {
  display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap;
  padding: 8px 10px; margin-bottom: var(--space-2);
  background: var(--c-surface-2); border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
}
.review__idx {
  flex: 0 0 auto; min-width: 26px; height: 26px; padding: 0 8px;
  display: inline-flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 14px; color: #fff; background: var(--c-primary);
  border-radius: 50%;
}
.review__conf { margin-left: auto; color: var(--c-text-subtle); font-size: 12px; }
.review__form :deep(.el-form-item) { margin-bottom: var(--space-2); }
.review__form :deep(.el-form-item__label) { font-size: 12px; color: var(--c-text-muted); padding-bottom: 2px; }
.review__actions { display: flex; gap: var(--space-2); margin-top: var(--space-2); }
/* 知识点建议：折叠面板，次级信息不干扰主流程 */
.review__sug-collapse { --el-collapse-header-font-size: 13px; border: none; }
.review__sug-collapse :deep(.el-collapse-item__header) { height: 36px; background: transparent; font-weight: 700; }
.review__sug-title { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--c-text); }
.review__sug-count { font-size: 11px; font-weight: 400; color: var(--c-text-subtle); background: var(--c-surface-2); border-radius: var(--radius-pill); padding: 0 8px; }
.review__sug { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 4px; }
.review__sug-tag :deep(.el-button) { margin-left: 2px; }

/* 审阅台内容编辑器（填空） */
.rv-blanks { display: flex; flex-direction: column; gap: var(--space-2); width: 100%; }
.rv-blank { display: flex; align-items: center; gap: var(--space-2); }

/* 框选编辑器 */
.bbox { display: flex; flex-direction: column; gap: var(--space-3); }
.bbox__bar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
.bbox__page { font-weight: 600; }
.bbox__left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bbox__hint { font-size: 12px; color: var(--c-text-subtle); }
.bbox__actions { display: flex; gap: 8px; flex-wrap: wrap; }
.bbox__tip { color: var(--c-text-muted); font-size: 12px; margin: 0; }
.bbox__stage { display: flex; justify-content: center; width: 100%; }
.bbox__wrap { position: relative; display: block; line-height: 0; user-select: none; touch-action: none; }
.bbox__img { display: block; width: 100%; height: auto; border-radius: 6px; }
.bbox__debug { border: 1px solid var(--c-border, #ebeef5); border-radius: 6px; }
.bbox__debug-title { font-size: 13px; font-weight: 600; color: var(--c-text-muted); }
.bbox__debug-block { margin-bottom: var(--space-3); }
.bbox__debug-label { font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--c-text-muted); }
.bbox__debug-pre {
  margin: 0; max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-all;
  background: var(--c-bg-subtle, #f5f7fa); border: 1px solid var(--c-border, #ebeef5);
  border-radius: 6px; padding: 8px; font-size: 12px; line-height: 1.5; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.bbox__box {
  position: absolute; outline: 2px solid #409eff; background: rgba(64, 158, 255, 0.12);
  cursor: move; box-sizing: border-box; touch-action: none;
}
.bbox__box.is-selected { outline-color: #f56c6c; background: rgba(245, 108, 108, 0.15); }
/* 只读框：已合并 / 被合并项，不可编辑（虚线 + 灰色） */
.bbox__box.is-readonly { outline-style: dashed; outline-color: #909399; background: rgba(144, 147, 153, 0.08); cursor: default; }
/* 已入库框：保留可拖动（改框会刷新入库状态），绿色虚线提示 */
.bbox__box.is-approved { outline-style: dashed; outline-color: #67c23a; background: rgba(103, 194, 58, 0.08); cursor: move; }
/* 题图拖动悬停目标题框：橙色高亮提示「归属到此题」 */
.bbox__box--fig-over { outline-color: #e6a23c !important; box-shadow: 0 0 0 2px rgba(230, 162, 60, 0.35); }
.bbox__fig--over { outline-color: #67c23a; background: rgba(103, 194, 58, 0.12); }
/* 状态角标 */
.bbox__box-badge {
  position: absolute; top: -22px; left: 34px; font-size: 10px; font-weight: 700;
  color: #fff; padding: 0 5px; border-radius: 3px; line-height: 15px;
}
.bbox__box-badge--merged { background: var(--c-primary, #4f6ef7); }
.bbox__box-badge--approved { background: #67c23a; }
/* 题内图片框（imgWrap 直接子级，全页坐标；可移动/缩放/删除） */
.bbox__fig {
  position: absolute; outline: 2px dashed #e6a23c; background: rgba(230, 162, 60, 0.10);
  cursor: move; pointer-events: auto; touch-action: none;
}
.bbox__fig-label {
  position: absolute; top: 0; left: 0; font-size: 10px; color: #fff; background: #e6a23c;
  padding: 0 4px; border-radius: 0 0 3px 0; line-height: 15px; white-space: nowrap;
}
.bbox__fig-del {
  position: absolute; top: -10px; right: -10px; width: 16px; height: 16px; line-height: 14px;
  text-align: center; font-size: 11px; color: #fff; background: #f56c6c; border-radius: 50%;
  cursor: pointer; z-index: 2;
}
.bbox__fig-handle {
  position: absolute; right: -5px; bottom: -5px; width: 12px; height: 12px; background: #e6a23c;
  border-radius: 50%; cursor: nwse-resize; touch-action: none; z-index: 2;
}
/* 页面级图片框：与题目框解耦，用青绿色虚线区分（题目框蓝、题目内图橙、页面图青） */
.bbox__fig--page { outline-color: #13c2c2; background: rgba(19, 194, 194, 0.10); }
.bbox__fig--page .bbox__fig-label { background: #13c2c2; }
.bbox__fig--page .bbox__fig-handle { background: #13c2c2; }
/* 新增图片框时的拖拽预览：青绿着色，与题目框区分 */
.bbox__draw--fig { border-color: #13c2c2; background: rgba(19, 194, 194, 0.12); }
/* 缩放滑块 */
.bbox__zoom { display: inline-flex; align-items: center; font-size: 12px; color: var(--c-text-muted); margin-left: 8px; }
.bbox__zoom-slider :deep(.el-slider__runway) { height: 4px; }
/* 题号：框上方左侧，黑色底白字，清晰可见 */
.bbox__box-index {
  position: absolute; top: -22px; left: 0; font-size: 11px; font-weight: 700;
  color: #fff; background: #000; padding: 0 6px; border-radius: 3px; line-height: 16px;
}
.bbox__box-del {
  position: absolute; top: -22px; right: 0; cursor: pointer; color: #f56c6c; font-size: 12px;
  background: #fff; border-radius: 3px; padding: 0 4px; line-height: 16px;
}
/* 题型标签：置于框下方左侧，避免与题号重叠 */
.bbox__box-type {
  position: absolute; bottom: -18px; left: 0; font-size: 10px; color: #fff; background: #909399;
  padding: 0 4px; border-radius: 3px; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis;
}
.bbox__box-handle {
  position: absolute; right: -5px; bottom: -5px; width: 12px; height: 12px; background: #409eff;
  border-radius: 50%; cursor: nwse-resize; touch-action: none;
}
.bbox__box-saving {
  position: absolute; bottom: 2px; left: 2px; font-size: 10px; color: #fff; background: rgba(0,0,0,0.5);
  padding: 0 3px; border-radius: 3px;
}
.bbox__draw { position: absolute; border: 2px dashed #67c23a; background: rgba(103, 194, 58, 0.12); pointer-events: none; }

:deep(.review-dialog) { max-height: 94vh; }
:deep(.review-dialog .el-dialog__body) { max-height: 82vh; overflow: auto; }
</style>
