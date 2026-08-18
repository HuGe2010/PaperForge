<script setup lang="ts">
/** 单个选项结构（大题选择题 / 阅读理解小题共用） */
export interface Option {
  key: string;
  text: string;
  correct?: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue: Option[];
    /** 单选（true）：勾选一个自动取消其余项；多选（false）：可勾选多个 */
    single?: boolean;
  }>(),
  { single: false },
);

const emit = defineEmits<{ (e: 'change'): void }>();
const notify = () => emit('change');

function add() {
  props.modelValue.push({ key: String.fromCharCode(65 + props.modelValue.length), text: '' });
  notify();
}
function remove(i: number) {
  props.modelValue.splice(i, 1);
  props.modelValue.forEach((o, idx) => (o.key = String.fromCharCode(65 + idx)));
  notify();
}
function onToggle(oi: number, val: boolean) {
  if (props.single && val) {
    props.modelValue.forEach((o, i) => (o.correct = i === oi));
  } else {
    props.modelValue[oi].correct = val;
  }
  notify();
}
</script>

<template>
  <div class="oe">
    <div v-for="(opt, oi) in modelValue" :key="oi" class="oe__opt">
      <el-checkbox
        :model-value="!!opt.correct"
        @change="(v: any) => onToggle(oi, v)"
        class="oe__check"
      />
      <span class="oe__key">{{ opt.key }}</span>
      <el-input v-model="opt.text" placeholder="选项内容（公式用 $...$ 包裹）" @input="notify" />
      <el-button text type="danger" size="small" :icon="'Close'" @click="remove(oi)" />
    </div>
    <el-button text type="primary" size="small" @click="add">+ 选项</el-button>
  </div>
</template>

<style scoped>
.oe { display: flex; flex-direction: column; gap: var(--space-2); width: 100%; }
.oe__opt { display: flex; align-items: center; gap: var(--space-2); }
.oe__check { margin-right: 0; }
.oe__key { width: 20px; font-weight: 700; text-align: center; color: var(--c-primary); flex: 0 0 auto; }
</style>
