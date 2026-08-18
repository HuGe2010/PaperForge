<script setup lang="ts">
import { ref, computed } from 'vue';
import { questionsApi } from '../../api/questions';
import FigurePickerDialog from './FigurePickerDialog.vue';

/** 题图（content.images 元素）：cropId 为裁切图唯一标识，label 为说明 */
export interface QuestionImage {
  cropId: string;
  label?: string;
}

const props = withDefaults(
  defineProps<{
    /** 当前题图列表（v-model） */
    modelValue: QuestionImage[];
    /** 只读模式（如详情查看态）：只展示、可点开预览，无删除/添加 */
    readonly?: boolean;
    /** 采用已框题图时，若某图仅含 bbox 需按页裁切，传入其所属页面 id */
    figurePageId?: string;
    /** 可采用的「已框题图」来源（审阅台从 OCR figures 注入），无则不显示该 tab */
    figurePool?: { cropId?: string; label?: string; bbox?: number[] }[];
    /** 「+图片」按钮文案 */
    addButtonText?: string;
  }>(),
  { readonly: false, figurePool: () => [], addButtonText: '＋图片' },
);

const emit = defineEmits<{
  (e: 'update:modelValue', v: QuestionImage[]): void;
}>();

const pickerVisible = ref(false);

const previewList = computed(() =>
  (props.modelValue || []).map((im) => questionsApi.figureUrl(im.cropId)),
);

function emitChange(next: QuestionImage[]) {
  emit('update:modelValue', next);
}

/** 采用 / 上传 / 从页裁切得到的图：去重后追加 */
function onAdd(cropId: string, label?: string) {
  const cur = Array.isArray(props.modelValue) ? [...props.modelValue] : [];
  if (cur.some((x) => x.cropId === cropId)) return;
  cur.push({ cropId, label: label || '题内图片' });
  emitChange(cur);
}

function onRemove(idx: number) {
  const cur = [...(props.modelValue || [])];
  cur.splice(idx, 1);
  emitChange(cur);
}

function onRelabel(idx: number, val: string) {
  const cur = (props.modelValue || []).map((x, i) => (i === idx ? { ...x, label: val } : x));
  emitChange(cur);
}
</script>

<template>
  <div class="qimg">
    <div v-if="!readonly" class="qimg__head">
      <el-button size="small" type="primary" plain :icon="'Picture'" @click="pickerVisible = true">
        {{ addButtonText }}
      </el-button>
      <span v-if="!modelValue || !modelValue.length" class="qimg__hint">
        暂无题图，可上传 / 从试卷页裁 / 采用已框题图
      </span>
    </div>

    <div v-if="modelValue && modelValue.length" class="qimg__list">
      <div v-for="(im, idx) in modelValue" :key="im.cropId" class="qimg__item">
        <div class="qimg__img-wrap">
          <el-image
            :src="questionsApi.figureUrl(im.cropId)"
            :preview-src-list="previewList"
            :initial-index="idx"
            fit="cover"
            class="qimg__img"
            hide-on-click-modal
          >
            <template #error>
              <div class="qimg__err">图缺失</div>
            </template>
          </el-image>
          <button v-if="!readonly" class="qimg__del" type="button" title="删除题图" @click="onRemove(idx)">
            ✕
          </button>
        </div>
        <el-input
          v-if="!readonly"
          :model-value="im.label"
          size="small"
          class="qimg__label"
          placeholder="题图说明"
          @update:model-value="(v: string) => onRelabel(idx, v)"
        />
        <span v-else class="qimg__label-text">{{ im.label || '题内图片' }}</span>
      </div>
    </div>

    <FigurePickerDialog v-model="pickerVisible" :figure-pool="figurePool" :figure-page-id="figurePageId" @confirm="onAdd" />
  </div>
</template>

<style scoped>
.qimg {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.qimg__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.qimg__hint {
  font-size: 12px;
  color: var(--c-text-subtle);
}
.qimg__list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.qimg__item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 96px;
}
.qimg__img-wrap {
  position: relative;
  width: 96px;
  height: 96px;
}
.qimg__img {
  width: 96px;
  height: 96px;
  border-radius: 6px;
  border: 1px solid var(--c-border);
  cursor: zoom-in;
}
.qimg__err {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 11px;
  color: var(--c-text-subtle);
  background: var(--c-bg-subtle, #f5f7fa);
}
.qimg__del {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  background: #f56c6c;
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}
.qimg__del:hover {
  background: #e64242;
}
.qimg__label {
  width: 96px;
}
.qimg__label-text {
  font-size: 11px;
  color: var(--c-text-muted);
  text-align: center;
}
</style>
