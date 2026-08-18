<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { questionsApi } from '../../api/questions';
import { ingestApi } from '../../api/ingest';

/**
 * 题图选择器（「+图片」通用组件）：
 * - Tab1 本地上传：选择本地图片 → POST /questions/figure-upload → cropId
 * - Tab2 从试卷页选择：列出已上传的图片任务 → 选页面 → 图上拖拽框选区域 → POST /questions/figure-from-page
 * 确认后 emit('confirm', cropId, label)。
 */
const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    label?: string;
    /** 可采用的「已框题图」来源（审阅台从 OCR figures 注入；无则不显示该 tab）。
     * 元素可只有 cropId（已裁切）或只有 bbox（待采用时按页裁切）；两者取一 */
    figurePool?: Array<{ cropId?: string; label?: string; bbox?: number[] }>;
    /** 采用已框题图时，若某图仅含 bbox 需按页裁切，传入其所属页面 id */
    figurePageId?: string;
  }>(),
  { label: '题内图片', figurePool: () => [], figurePageId: '' },
);
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'confirm', cropId: string, label?: string): void;
}>();

const tab = ref<'upload' | 'page' | 'pool'>('upload');
const uploading = ref(false);

// ---------------- Tab3 采用已框题图 ----------------
// 池内元素可能只有 cropId（已裁切）或只有 bbox（待采用时再裁）；用稳定 key 区分
function poolKey(f: { cropId?: string; label?: string; bbox?: number[] }): string {
  return f.cropId || (f.bbox ? `bbox:${f.bbox.join(',')}` : `idx:${f.label || ''}`);
}
const poolSel = ref<Set<string>>(new Set());
const poolPreview = computed(() =>
  (props.figurePool || []).map((f) => (f.cropId ? questionsApi.figureUrl(f.cropId) : '')),
);
function poolIndex(f: { cropId?: string; label?: string; bbox?: number[] }): number {
  return (props.figurePool || []).findIndex((x) => poolKey(x) === poolKey(f));
}
function togglePool(f: { cropId?: string; label?: string; bbox?: number[] }) {
  const k = poolKey(f);
  const next = new Set(poolSel.value);
  if (next.has(k)) next.delete(k);
  else next.add(k);
  poolSel.value = next;
}
async function adoptSelected() {
  const chosen = (props.figurePool || []).filter((f) => poolSel.value.has(poolKey(f)));
  for (const f of chosen) {
    if (f.cropId) {
      emit('confirm', f.cropId, f.label || '题内图片');
    } else if (f.bbox && props.figurePageId) {
      // 仅有 bbox：按所属页面实时裁切，拿 cropId 后再采用
      try {
        const res = await questionsApi.figureFromPage({ pageId: props.figurePageId, bbox: f.bbox });
        emit('confirm', res.cropId, f.label || '题内图片');
      } catch {
        /* 单张裁切失败忽略，不阻断其余 */
      }
    }
  }
  poolSel.value = new Set();
  emit('update:modelValue', false);
}

// ---------------- Tab1 上传 ----------------
async function onUploadFile(file: File) {
  uploading.value = true;
  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await questionsApi.figureUpload(fd);
    done(res.cropId);
  } catch {
    /* 拦截器已提示 */
  } finally {
    uploading.value = false;
  }
}

function done(cropId: string) {
  emit('confirm', cropId, props.label || '题内图片');
  emit('update:modelValue', false);
}

// ---------------- Tab2 从试卷页选择 ----------------
const jobs = ref<any[]>([]);
const jobsLoading = ref(false);
const selJob = ref<any>(null);
const pages = ref<any[]>([]);
const selPage = ref<any>(null);
const pageUrl = ref('');
const drawing = ref<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
const cropBbox = ref<number[] | null>(null);
const cropping = ref(false);
const pageBox = ref<HTMLElement | null>(null);

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      tab.value = 'upload';
      cropBbox.value = null;
      selJob.value = null;
      selPage.value = null;
      pages.value = [];
      pageUrl.value = '';
      poolSel.value = new Set();
      loadJobs();
    }
  },
);

async function loadJobs() {
  jobsLoading.value = true;
  try {
    const res: any = await ingestApi.list({ page: 1, pageSize: 50 });
    jobs.value = (res.items || []).filter((j: any) => j.fileType === 'image');
  } catch {
    /* 忽略 */
  } finally {
    jobsLoading.value = false;
  }
}
async function pickJob(job: any) {
  selJob.value = job;
  selPage.value = null;
  pageUrl.value = '';
  cropBbox.value = null;
  try {
    const full: any = await ingestApi.get(job.id);
    pages.value = full.pages || [];
    if (pages.value.length) {
      selPage.value = pages.value[0];
      await loadPageImage();
    }
  } catch {
    /* 忽略 */
  }
}
async function loadPageImage() {
  if (!selPage.value) return;
  if (pageUrl.value) URL.revokeObjectURL(pageUrl.value);
  try {
    pageUrl.value = await ingestApi.pageImageUrl(selPage.value.id);
    cropBbox.value = null;
  } catch {
    pageUrl.value = '';
  }
}

// 把指针坐标归一到整页图（0~1）。画布可滚动：需扣 scrollLeft/Top，且分母用内容尺寸而非可视区，否则长图滚动后框选漂移。
function pageNorm(e: PointerEvent): [number, number] {
  const box = pageBox.value!;
  const r = box.getBoundingClientRect();
  const cw = box.scrollWidth || r.width;
  const ch = box.scrollHeight || r.height;
  const x = Math.min(1, Math.max(0, (e.clientX - r.left + box.scrollLeft) / cw));
  const y = Math.min(1, Math.max(0, (e.clientY - r.top + box.scrollTop) / ch));
  return [x, y];
}
function onPageDown(e: PointerEvent) {
  if (!pageBox.value) return;
  const [x, y] = pageNorm(e);
  drawing.value = { x0: x, y0: y, x1: x, y1: y };
  window.addEventListener('pointermove', onPageMove);
  window.addEventListener('pointerup', onPageUp);
}
function onPageMove(e: PointerEvent) {
  if (!drawing.value || !pageBox.value) return;
  const [x, y] = pageNorm(e);
  drawing.value.x1 = x;
  drawing.value.y1 = y;
}
function onPageUp() {
  window.removeEventListener('pointermove', onPageMove);
  window.removeEventListener('pointerup', onPageUp);
  const d = drawing.value;
  drawing.value = null;
  if (!d) return;
  const x0 = Math.min(d.x0, d.x1);
  const y0 = Math.min(d.y0, d.y1);
  const x1 = Math.max(d.x0, d.x1);
  const y1 = Math.max(d.y0, d.y1);
  // 拖得太小视为点选：默认框选整页
  cropBbox.value = x1 - x0 > 0.02 && y1 - y0 > 0.02 ? [x0, y0, x1, y1] : [0, 0, 1, 1];
}

async function confirmFromPage() {
  if (!selPage.value) return ElMessage.warning('请先选择页面');
  cropping.value = true;
  try {
    const res = await questionsApi.figureFromPage({ pageId: selPage.value.id, bbox: cropBbox.value || [0, 0, 1, 1] });
    done(res.cropId);
  } catch {
    /* 拦截器已提示 */
  } finally {
    cropping.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="添加题内图片"
    width="720px"
    top="6vh"
    :close-on-click-modal="false"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <el-tabs v-model="tab">
      <!-- 本地上传 -->
      <el-tab-pane label="本地上传" name="upload">
        <el-upload
          drag
          :auto-upload="false"
          :show-file-list="false"
          accept="image/*"
          :disabled="uploading"
          @change="(f: any) => f?.raw && onUploadFile(f.raw)"
        >
          <div class="fp-upload">
            <el-icon :size="32"><Picture /></el-icon>
            <div>点击或拖拽图片到此处上传</div>
            <div class="fp-upload-tip">支持 jpg / png / webp 等图片格式</div>
          </div>
        </el-upload>
        <div v-if="uploading" class="fp-tip">上传中…</div>
      </el-tab-pane>

      <!-- 从试卷页选择 -->
      <el-tab-pane label="从 PDF/图片页选择" name="page">
        <div class="fp-page">
          <div class="fp-page-left" v-loading="jobsLoading">
            <div class="fp-page-label">已上传的图片文件</div>
            <div
              v-for="j in jobs"
              :key="j.id"
              class="fp-job"
              :class="{ 'is-active': selJob?.id === j.id }"
              :title="j.fileName"
              @click="pickJob(j)"
            >
              <span class="fp-job-name">{{ j.fileName }}</span>
              <span class="fp-job-count">{{ j.pageCount ?? 0 }} 页</span>
            </div>
            <el-empty v-if="!jobs.length && !jobsLoading" description="暂无图片文件，先到 OCR 录题上传" :image-size="50" />
          </div>
          <div class="fp-page-right">
            <div class="fp-page-label">页面（拖拽框选题图区域，不框选默认整页）</div>
            <el-select
              v-if="pages.length > 1"
              v-model="selPage"
              size="small"
              style="width: 100%; margin-bottom: 6px"
              @change="loadPageImage"
            >
              <el-option v-for="(p, i) in pages" :key="p.id" :label="`第 ${i + 1} 页`" :value="p" />
            </el-select>
            <div ref="pageBox" class="fp-canvas" @pointerdown="onPageDown">
              <div class="fp-content">
              <img v-if="pageUrl" :src="pageUrl" class="fp-canvas-img" draggable="false" />
              <div v-else class="fp-canvas-empty">请先选择文件与页面</div>
              <div
                v-if="drawing"
                class="fp-draw"
                :style="{
                  left: Math.min(drawing.x0, drawing.x1) * 100 + '%',
                  top: Math.min(drawing.y0, drawing.y1) * 100 + '%',
                  width: Math.abs(drawing.x1 - drawing.x0) * 100 + '%',
                  height: Math.abs(drawing.y1 - drawing.y0) * 100 + '%',
                }"
              />
              <div
                v-if="cropBbox"
                class="fp-crop"
                :style="{
                  left: cropBbox[0] * 100 + '%',
                  top: cropBbox[1] * 100 + '%',
                  width: (cropBbox[2] - cropBbox[0]) * 100 + '%',
                  height: (cropBbox[3] - cropBbox[1]) * 100 + '%',
                }"
              >
                <span class="fp-crop-tip">已框选，可重新拖拽</span>
              </div>
              </div>
            </div>
            <div class="fp-actions">
              <el-button size="small" @click="cropBbox = null">清除框选</el-button>
              <el-button size="small" type="primary" :loading="cropping" @click="confirmFromPage">确定添加</el-button>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- 采用已框题图（审阅台从 OCR figures 注入） -->
      <el-tab-pane v-if="figurePool && figurePool.length" label="采用已框题图" name="pool">
        <div class="fp-pool">
          <div class="fp-pool-tip">
            以下为「框选编辑器」里已框出的题图，勾选需要采用的，点「采用选中」加入本题；未采用的题图在入库时也会一并归入。
          </div>
          <div class="fp-pool-list">
            <div
              v-for="f in figurePool"
              :key="poolKey(f)"
              class="fp-pool-item"
              :class="{ 'is-sel': poolSel.has(poolKey(f)) }"
              @click="togglePool(f)"
            >
              <el-image
                :src="f.cropId ? questionsApi.figureUrl(f.cropId) : ''"
                :preview-src-list="poolPreview"
                :initial-index="poolIndex(f)"
                fit="cover"
                class="fp-pool-img"
                hide-on-click-modal
              />
              <span class="fp-pool-name">{{ f.label || '题内图片' }}</span>
              <span v-if="poolSel.has(poolKey(f))" class="fp-pool-check">✓</span>
            </div>
          </div>
          <div class="fp-actions">
            <el-button size="small" @click="poolSel = new Set()">清空选择</el-button>
            <el-button size="small" type="primary" :disabled="!poolSel.size" @click="adoptSelected">
              采用选中（{{ poolSel.size }}）
            </el-button>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>

<style scoped>
.fp-upload { display: flex; flex-direction: column; align-items: center; gap: 6px; color: var(--c-text-muted); font-size: 13px; padding: 12px 0; }
.fp-upload-tip { font-size: 11px; color: var(--c-text-subtle); }
.fp-tip { font-size: 12px; color: var(--c-text-muted); margin-top: 6px; }
.fp-page { display: flex; gap: var(--space-3); height: 380px; }
.fp-page-left { flex: 0 0 200px; display: flex; flex-direction: column; gap: 4px; overflow: auto; border: 1px solid var(--c-border); border-radius: 6px; padding: 6px; }
.fp-page-label { font-size: 12px; font-weight: 600; color: var(--c-text-muted); }
.fp-job { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.fp-job:hover { background: var(--c-bg-soft, #f5f7fa); }
.fp-job.is-active { background: rgba(79, 110, 247, 0.1); color: var(--c-primary); }
.fp-job-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-job-count { font-size: 10px; color: var(--c-text-subtle); }
.fp-page-right { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.fp-canvas { position: relative; flex: 1; min-height: 240px; overflow: auto; background: var(--c-bg-soft, #f5f7fa); border: 1px solid var(--c-border); border-radius: 6px; cursor: crosshair; touch-action: none; user-select: none; }
.fp-content { position: relative; width: 100%; }
.fp-canvas-img { display: block; width: 100%; height: auto; }
.fp-canvas-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--c-text-subtle); font-size: 12px; }
.fp-draw { position: absolute; border: 2px dashed #409eff; background: rgba(64, 158, 255, 0.12); pointer-events: none; }
.fp-crop { position: absolute; border: 2px solid #f56c6c; background: rgba(245, 108, 108, 0.10); pointer-events: none; }
.fp-crop-tip { position: absolute; top: -18px; left: 0; font-size: 10px; color: #fff; background: #f56c6c; padding: 0 4px; border-radius: 3px; white-space: nowrap; }
.fp-actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
.fp-pool { display: flex; flex-direction: column; gap: 8px; height: 380px; overflow: auto; }
.fp-pool-tip { font-size: 12px; color: var(--c-text-muted); line-height: 1.5; }
.fp-pool-list { display: flex; flex-wrap: wrap; gap: 8px; align-content: flex-start; }
.fp-pool-item {
  position: relative; width: 96px; height: 116px; display: flex; flex-direction: column; gap: 2px;
  border: 2px solid transparent; border-radius: 8px; padding: 3px; cursor: pointer; background: var(--c-bg-subtle, #f5f7fa);
  overflow: hidden;
}
.fp-pool-item.is-sel { border-color: var(--c-primary); background: rgba(79, 110, 247, 0.08); }
.fp-pool-img { width: 100%; height: 90px; display: block; border-radius: 6px; overflow: hidden; }
/* el-image 内部 <img> 不受 scoped 样式约束，需强制铺满容器，避免宽/高图溢出卡片 */
.fp-pool-item :deep(.el-image) {
  width: 100% !important;
  height: 90px !important;
  display: block;
  overflow: hidden;
}
.fp-pool-item :deep(.el-image__inner) {
  width: 100% !important;
  height: 100% !important;
  object-fit: cover !important;
  display: block;
}
.fp-pool-name { font-size: 11px; color: var(--c-text-muted); text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-pool-check {
  position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 50%;
  background: var(--c-primary); color: #fff; font-size: 12px; display: flex; align-items: center; justify-content: center;
}
</style>
