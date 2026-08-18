<script setup lang="ts">
import { QUESTION_TYPE_OPTIONS, type QuestionType } from '../../types/models';
import type { SubQuestionEdit } from '../../types/subQuestion';
import OptionsEditor from './OptionsEditor.vue';
import QuestionImageEditor from '../biz/QuestionImageEditor.vue';

const props = withDefaults(
  defineProps<{
    modelValue: SubQuestionEdit[];
    /** 是否显示小题题型下拉（阅读理解=true，材料题=false） */
    showType?: boolean;
  }>(),
  { showType: true },
);

const emit = defineEmits<{ (e: 'change'): void }>();
const notify = () => emit('change');

const isChoice = (t: QuestionType | '') => t === 'SINGLE_CHOICE' || t === 'MULTIPLE_CHOICE';

function add() {
  props.modelValue.push({ type: '', stem: '', options: [] });
  notify();
}
function remove(i: number) {
  props.modelValue.splice(i, 1);
  notify();
}
</script>

<template>
  <div class="sqe">
    <div v-for="(sq, si) in modelValue" :key="si" class="sqe__sub">
      <div class="sqe__head">
        <b>小题{{ si + 1 }}</b>
        <el-select v-if="showType" v-model="sq.type" placeholder="题型" size="small" style="width: 130px" @change="notify">
          <el-option v-for="o in QUESTION_TYPE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-button text type="danger" size="small" :icon="'Close'" @click="remove(si)" />
      </div>

      <el-input v-model="sq.stem" type="textarea" :rows="2" placeholder="小题题干（公式用 $...$ 包裹）" @input="notify" />

      <QuestionImageEditor
        :model-value="sq.images || []"
        @update:model-value="(v: any) => { sq.images = v; notify(); }"
      />

      <!-- 选择类小题：选项 + 正确项勾选（单选唯一 / 多选可多个） -->
      <OptionsEditor v-if="showType && isChoice(sq.type)" :model-value="sq.options" :single="sq.type === 'SINGLE_CHOICE'" @change="notify" />

      <!-- 简答类 / 材料题小题：参考答案 -->
      <el-input v-else v-model="sq.answer" placeholder="参考答案（选填）" size="small" @input="notify" />
    </div>

    <el-button text type="primary" @click="add">+ 小题</el-button>
  </div>
</template>

<style scoped>
.sqe { display: flex; flex-direction: column; gap: var(--space-2); width: 100%; }
.sqe__sub {
  display: flex; flex-direction: column; gap: var(--space-2);
  padding: var(--space-2); border: 1px dashed var(--c-border); border-radius: 6px;
}
.sqe__head { display: flex; align-items: center; gap: var(--space-2); }
</style>
