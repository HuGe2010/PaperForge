<script setup lang="ts">
import { computed } from 'vue';
import MathText from './MathText.vue';
import QuestionImageEditor from '../biz/QuestionImageEditor.vue';
import { type QuestionType, type QuestionContent, QUESTION_TYPE_LABEL } from '../../types/models';

const props = withDefaults(
  defineProps<{
    type?: QuestionType | null;
    stem?: string | null;
    content?: QuestionContent | null;
    analysis?: string | null;
    /** 紧凑模式（卡片/列表预览用） */
    compact?: boolean;
  }>(),
  { compact: false },
);

const options = computed(() => props.content?.options ?? []);
const blanks = computed(() => props.content?.blanks ?? []);
const subQuestions = computed(() => props.content?.subQuestions ?? []);
const isChoice = computed(
  () => props.type === 'SINGLE_CHOICE' || props.type === 'MULTIPLE_CHOICE',
);

// 判断题：优先用结构化 options（带 correct），否则根据 answer(T/F) 合成正确/错误两选项并高亮答案
const tfOptions = computed(() => {
  if (props.type !== 'TRUE_FALSE') return [];
  const raw = props.content?.options ?? [];
  if (raw.length) return raw;
  const ans = props.content?.answer;
  if (ans === 'T' || ans === '正确' || ans === '对') {
    return [
      { key: 'A', text: '正确', correct: true },
      { key: 'B', text: '错误', correct: false },
    ];
  }
  if (ans === 'F' || ans === '错误' || ans === '错') {
    return [
      { key: 'A', text: '正确', correct: false },
      { key: 'B', text: '错误', correct: true },
    ];
  }
  return [];
});

// 小题自身题型的中文标签（阅读理解/材料题的小题可能是选择或简答）
const subTypeLabel = (t?: string | null) =>
  (t && QUESTION_TYPE_LABEL[t as QuestionType]) || '';
</script>

<template>
  <div class="qcv" :class="{ 'qcv--compact': compact }">
    <!-- 题干 -->
    <div class="qcv__stem">
      <MathText :value="stem || '（无题干）'" :inline="false" />
    </div>

    <!-- 选择题 -->
    <ul v-if="isChoice && options.length" class="qcv__options">
      <li
        v-for="opt in options"
        :key="opt.key"
        class="qcv__option"
        :class="{ 'is-correct': opt.correct }"
      >
        <span class="qcv__opt-key">{{ opt.key }}</span>
        <span class="qcv__opt-text"><MathText :value="opt.text" /></span>
        <span v-if="opt.correct" class="qcv__opt-mark">✓</span>
      </li>
    </ul>

    <!-- 判断题：结构化选项或按答案合成，均高亮正确答案 -->
    <ul v-else-if="type === 'TRUE_FALSE' && tfOptions.length" class="qcv__options">
      <li
        v-for="opt in tfOptions"
        :key="opt.key"
        class="qcv__option"
        :class="{ 'is-correct': opt.correct }"
      >
        <span class="qcv__opt-key">{{ opt.key }}</span>
        <span class="qcv__opt-text">{{ opt.text }}</span>
        <span v-if="opt.correct" class="qcv__opt-mark">✓</span>
      </li>
    </ul>

    <!-- 判断题（既无选项也无答案时兜底提示） -->
    <div v-else-if="type === 'TRUE_FALSE' && !tfOptions.length" class="qcv__answer">
      <span class="qcv__muted">（判断题暂无答案）</span>
    </div>

    <!-- 填空题 -->
    <div v-else-if="type === 'FILL_BLANK' && blanks.length" class="qcv__blanks">
      <div class="qcv__label">参考答案：</div>
      <div class="qcv__blank-list">
        <span v-for="(b, i) in blanks" :key="i" class="qcv__blank">
          <i>空{{ i + 1 }}：</i><MathText :value="b" />
        </span>
      </div>
    </div>

    <!-- 材料题小题 -->
    <div v-else-if="type === 'MATERIAL' && subQuestions.length" class="qcv__subs">
      <div v-for="(sq, i) in subQuestions" :key="i" class="qcv__sub">
        <div class="qcv__sub-stem"><b>小题{{ i + 1 }}：</b><MathText :value="sq.stem" /></div>
        <QuestionImageEditor v-if="sq.images?.length" :model-value="sq.images || []" readonly class="qcv__sub-figs" />
        <div v-if="sq.answer" class="qcv__sub-ans">答：<MathText :value="sq.answer" /></div>
      </div>
    </div>

    <!-- 阅读理解大题：多个小题，小题按自身题型渲染（选择类像单选题高亮正确答案，简答类题干+答案） -->
    <div v-else-if="type === 'READING_COMPREHENSION'" class="qcv__reading">
      <div v-for="(sq, i) in subQuestions" :key="i" class="qcv__sub">
        <div class="qcv__sub-stem">
          <b>小题{{ i + 1 }}{{ subTypeLabel(sq.type) ? `（${subTypeLabel(sq.type)}）` : '' }}：</b>
          <MathText :value="sq.stem" />
        </div>
        <QuestionImageEditor v-if="sq.images?.length" :model-value="sq.images || []" readonly class="qcv__sub-figs" />
        <!-- 选择类小题：选项 + 正确答案高亮（不再显示「答：/解析：」行） -->
        <ul v-if="(sq.type === 'SINGLE_CHOICE' || sq.type === 'MULTIPLE_CHOICE') && sq.options?.length" class="qcv__options">
          <li v-for="opt in sq.options" :key="opt.key" class="qcv__option" :class="{ 'is-correct': opt.correct }">
            <span class="qcv__opt-key">{{ opt.key }}</span>
            <span class="qcv__opt-text"><MathText :value="opt.text" /></span>
            <span v-if="opt.correct" class="qcv__opt-mark">✓</span>
          </li>
        </ul>
        <!-- 简答类小题：题干 + 答案（无选项） -->
        <div v-else-if="sq.answer" class="qcv__sub-ans">答：<MathText :value="sq.answer" /></div>
      </div>
    </div>

    <!-- 简答/论述：含多个小问时逐个渲染；否则渲染参考答案（AI 解答回填 answer）或评分要点 -->
    <div v-else-if="(type === 'SHORT_ANSWER' || type === 'ESSAY') && subQuestions.length" class="qcv__subs">
      <div v-for="(sq, i) in subQuestions" :key="i" class="qcv__sub">
        <div class="qcv__sub-stem">
          <b>小题{{ i + 1 }}{{ typeof sq.score === 'number' ? `（${sq.score} 分）` : '' }}：</b>
          <MathText :value="sq.stem" />
        </div>
        <QuestionImageEditor v-if="sq.images?.length" :model-value="sq.images || []" readonly class="qcv__sub-figs" />
        <div v-if="sq.answer" class="qcv__sub-ans">答：<MathText :value="sq.answer" /></div>
      </div>
    </div>
    <div v-else-if="(type === 'SHORT_ANSWER' || type === 'ESSAY') && content?.answer" class="qcv__rubric">
      <div class="qcv__label">参考答案：</div>
      <MathText :value="content.answer" :inline="false" />
    </div>
    <div v-else-if="(type === 'SHORT_ANSWER' || type === 'ESSAY') && content?.rubric" class="qcv__rubric">
      <div class="qcv__label">评分要点 / 参考答案：</div>
      <MathText :value="content.rubric" :inline="false" />
    </div>

    <!-- 解析 -->
    <div v-if="analysis" class="qcv__analysis">
      <div class="qcv__label">解析：</div>
      <MathText :value="analysis" :inline="false" />
    </div>
  </div>
</template>

<style scoped>
.qcv { display: flex; flex-direction: column; gap: var(--space-2); }
.qcv--compact { font-size: 13px; }
.qcv__stem { font-size: 15px; line-height: 1.7; color: var(--c-text); }
.qcv--compact .qcv__stem { font-size: 13px; }
.qcv__options { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.qcv__option {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 6px 10px; border: 1px solid var(--c-border); border-radius: 6px;
  background: var(--c-surface);
}
.qcv__option.is-correct { border-color: var(--c-success, #67c23a); background: rgba(103, 194, 58, 0.08); }
.qcv__opt-key {
  flex: 0 0 auto; font-weight: 700; color: var(--c-text);
  min-width: 18px; text-align: center;
}
.qcv__opt-text { flex: 1; }
.qcv__opt-mark { color: var(--c-success, #67c23a); font-weight: 700; }
.qcv__label { font-size: 12px; color: var(--c-text-subtle); font-weight: 600; margin-bottom: 2px; }
.qcv__muted { color: var(--c-text-subtle); }
.qcv__blanks, .qcv__rubric, .qcv__answer { font-size: 14px; color: var(--c-text); }
.qcv__blank-list { display: flex; flex-wrap: wrap; gap: 10px; }
.qcv__blank i { color: var(--c-text-subtle); font-style: normal; }
.qcv__sub { padding: 6px 0; border-top: 1px dashed var(--c-border); }
.qcv__sub:first-child { border-top: none; }
.qcv__sub-stem { color: var(--c-text); }
.qcv__sub-figs { margin-top: 4px; }
.qcv__sub-ans { color: var(--c-text-muted); margin-top: 2px; }
.qcv__reading { display: flex; flex-direction: column; gap: var(--space-2); }
.qcv__analysis { margin-top: 4px; padding-top: 6px; border-top: 1px dashed var(--c-border); }
.qcv--compact .qcv__option { padding: 3px 8px; }
</style>
