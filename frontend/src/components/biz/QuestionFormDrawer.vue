<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { questionsApi, type CreateQuestionPayload } from '../../api/questions';
import { subjectsApi } from '../../api/subjects';
import { tagsApi } from '../../api/tags';
import { knowledgeApi } from '../../api/knowledge';
import { QUESTION_TYPE_OPTIONS, SUBJECT_TREE_PROPS, KP_TREE_PROPS, type QuestionType, type QuestionContent, type Subject, type Tag, type KnowledgePoint, type QuestionDetail } from '../../types/models';
import { subQuestionsToContent, optionsToAnswer, type SubQuestionEdit } from '../../types/subQuestion';
import MathText from '../base/MathText.vue';
import SubQuestionsEditor from '../base/SubQuestionsEditor.vue';
import OptionsEditor from '../base/OptionsEditor.vue';
import QuestionImageEditor from './QuestionImageEditor.vue';

const props = defineProps<{ modelValue: boolean; question?: QuestionDetail | null }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'saved'): void }>();

const isEdit = computed(() => !!props.question?.id);

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const form = reactive<{
  type: QuestionType;
  stem: string;
  difficulty: number;
  subjectId: string | undefined;
  tagIds: string[];
  knowledgePointIds: string[];
  analysis: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  content: QuestionContent;
}>({
  type: 'SINGLE_CHOICE',
  stem: '',
  difficulty: 3,
  subjectId: undefined,
  tagIds: [],
  knowledgePointIds: [],
  analysis: '',
  status: 'PUBLISHED',
  content: { options: [] },
});

const subjects = ref<Subject[]>([]);
const tags = ref<Tag[]>([]);
const kpTree = ref<KnowledgePoint[]>([]);
const saving = ref(false);
const showPreview = ref(false);

const isChoice = computed(() => form.type === 'SINGLE_CHOICE' || form.type === 'MULTIPLE_CHOICE');

function resetForm() {
  const q = props.question;
  form.type = q?.type ?? 'SINGLE_CHOICE';
  form.stem = q?.stem ?? '';
  form.difficulty = q?.difficulty ?? 3;
  form.subjectId = q?.subject?.id ?? undefined;
  form.tagIds = q?.tags?.map((t) => t.id) ?? [];
  form.knowledgePointIds = q?.knowledgePoints?.map((k) => k.id) ?? [];
  form.analysis = q?.analysis ?? '';
  form.status = q?.status ?? 'PUBLISHED';
  form.content = q?.content ? { ...q.content } : { options: [] };
  if (isChoice.value && !form.content.options) form.content.options = [];
  // 阅读理解/材料/简答/论述：深拷贝小题列表，避免编辑直接改动父组件数据
  if (form.type === 'READING_COMPREHENSION' || form.type === 'MATERIAL' || form.type === 'SHORT_ANSWER' || form.type === 'ESSAY') {
    form.content.subQuestions = Array.isArray(form.content.subQuestions)
      ? form.content.subQuestions.map((s: any) => ({
          type: s.type ?? '',
          stem: s.stem ?? '',
          options: (s.options || []).map((o: any) => ({ key: o.key, text: o.text ?? '', correct: o.correct })),
          answer: s.answer ?? '',
          images: Array.isArray(s.images) ? s.images.map((i: any) => ({ cropId: i.cropId, label: i.label })) : [],
        }))
      : [];
  }
}

watch(open, (v) => {
  if (v) {
    resetForm();
    loadSelectors();
  }
});

async function loadSelectors() {
  try {
    const [s, t] = await Promise.all([subjectsApi.tree(), tagsApi.list()]);
    subjects.value = s as unknown as Subject[];
    tags.value = t as unknown as Tag[];
    if (form.subjectId) loadKp(form.subjectId);
  } catch {
    /* 拦截器已提示 */
  }
}

async function loadKp(subjectId: string) {
  try {
    kpTree.value = (await knowledgeApi.tree(subjectId)) as unknown as KnowledgePoint[];
  } catch {
    kpTree.value = [];
  }
}

watch(() => form.subjectId, (id) => {
  form.knowledgePointIds = [];
  if (id) loadKp(id);
});

// 填空题空答案
const blanks = ref<string[]>(['']);
watch(() => form.type, (t) => {
  if (t === 'FILL_BLANK' && !form.content.blanks) {
    form.content.blanks = [''];
    blanks.value = form.content.blanks;
  }
  // 阅读理解/材料/简答/论述：确保小题列表存在（新建题目切题型时初始化，否则「+ 小题」无法 push）
  if ((t === 'READING_COMPREHENSION' || t === 'MATERIAL' || t === 'SHORT_ANSWER' || t === 'ESSAY') && !form.content.subQuestions) {
    form.content.subQuestions = [];
  }
});
watch(blanks, (v) => { form.content.blanks = v; }, { deep: true });
watch(() => props.question, () => {
  if (open.value) {
    resetForm();
    blanks.value = form.content.blanks || [''];
  }
});

async function onSave() {
  // 阅读理解大题：题干（引语）可空，给占位标题（题目内容在小题里）
  if (form.type === 'READING_COMPREHENSION' && !form.stem.trim()) {
    form.stem = '阅读理解';
  }
  if (!form.stem.trim()) {
    ElMessage.warning('请填写题干');
    return;
  }
  if (isChoice.value && (form.content.options?.length ?? 0) < 2) {
    ElMessage.warning('选择题至少需要 2 个选项');
    return;
  }
  // 选择题：从正确项推导 answer（"A"/"AB"）
  if (isChoice.value) {
    form.content.answer = optionsToAnswer(form.content.options || []);
  }
  // 阅读理解/材料/简答/论述：把小题编辑结构转成 content.subQuestions（correct 布尔 → options + answer）
  if (form.type === 'READING_COMPREHENSION' || form.type === 'MATERIAL' || form.type === 'SHORT_ANSWER' || form.type === 'ESSAY') {
    form.content.subQuestions = subQuestionsToContent(form.content.subQuestions as SubQuestionEdit[]);
  }
  const payload: CreateQuestionPayload = {
    type: form.type,
    stem: form.stem,
    content: form.content,
    analysis: form.analysis || undefined,
    difficulty: undefined,
  };
  // 把 difficulty 显式传入（CreateQuestionPayload 不强制，这里直接塞）
  (payload as any).difficulty = form.difficulty;
  if (form.subjectId) payload.subjectId = form.subjectId;
  if (form.tagIds.length) payload.tagIds = form.tagIds;
  if (form.knowledgePointIds.length) payload.knowledgePointIds = form.knowledgePointIds;
  payload.status = form.status;
  payload.sourceType = 'MANUAL';

  saving.value = true;
  try {
    if (isEdit.value) {
      await questionsApi.update(props.question!.id, payload);
      ElMessage.success('已保存');
    } else {
      await questionsApi.create(payload);
      ElMessage.success('已创建');
    }
    emit('saved');
    open.value = false;
  } catch {
    /* 拦截器已提示 */
  } finally {
    saving.value = false;
  }
}

function confirmDelete() {
  if (!props.question?.id) return;
  ElMessageBox.confirm('删除后该题目将无法恢复，且可能影响已关联的试卷。', '确认删除', {
    type: 'warning',
  }).then(async () => {
    await questionsApi.remove(props.question!.id);
    ElMessage.success('已删除');
    emit('saved');
    open.value = false;
  }).catch(() => {});
}
</script>

<template>
  <el-drawer v-model="open" :title="isEdit ? '编辑题目' : '新建题目'" size="560px" :destroy-on-close="true">
    <el-form label-position="top" class="q-form">
      <el-form-item label="题型">
        <el-select v-model="form.type" :disabled="isEdit" style="width: 100%">
          <el-option v-for="o in QUESTION_TYPE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </el-form-item>

      <el-form-item label="题干">
        <el-input v-model="form.stem" type="textarea" :rows="3" placeholder="例如：求函数 $f(x)=x^2$ 的导数" />
        <QuestionImageEditor
          :model-value="(form.content.images as any[]) || []"
          @update:model-value="(v: any) => (form.content.images = v)"
        />
      </el-form-item>
      <div v-if="form.type !== 'READING_COMPREHENSION' && form.stem" class="q-form__preview">
        <span class="q-form__preview-label">预览</span>
        <MathText :value="form.stem" />
      </div>

      <el-form-item label="难度">
        <el-rate v-model="form.difficulty" :max="5" show-score />
      </el-form-item>

      <el-form-item label="学科">
        <el-tree-select
          v-model="form.subjectId"
          :data="subjects"
          :props="SUBJECT_TREE_PROPS"
          check-strictly
          clearable
          placeholder="选择学科"
          style="width: 100%"
        />
      </el-form-item>

      <el-form-item label="知识点">
        <el-tree-select
          v-model="form.knowledgePointIds"
          :data="kpTree"
          :props="KP_TREE_PROPS"
          multiple
          check-strictly
          clearable
          :disabled="!form.subjectId"
          placeholder="先选择学科，再勾选知识点"
          style="width: 100%"
        />
      </el-form-item>

      <el-form-item label="标签">
        <el-select v-model="form.tagIds" multiple filterable allow-create default-first-option clearable placeholder="选择或输入新标签" style="width: 100%">
          <el-option v-for="t in tags" :key="t.id" :label="t.name" :value="t.id" />
        </el-select>
      </el-form-item>

      <!-- 题型专属内容 -->
      <template v-if="isChoice">
        <el-divider>选项设置</el-divider>
        <OptionsEditor :model-value="form.content.options as any[]" :single="form.type === 'SINGLE_CHOICE'" />
      </template>

      <template v-else-if="form.type === 'TRUE_FALSE'">
        <el-form-item label="正确答案">
          <el-radio-group v-model="(form.content as any).answer">
            <el-radio value="true">正确</el-radio>
            <el-radio value="false">错误</el-radio>
          </el-radio-group>
        </el-form-item>
      </template>

      <template v-else-if="form.type === 'FILL_BLANK'">
        <el-divider>填空答案（每空一行）</el-divider>
        <div v-for="(b, i) in blanks" :key="i" class="q-blank">
          <span class="q-blank__idx">第 {{ i + 1 }} 空</span>
          <el-input v-model="blanks[i]" placeholder="该空答案" />
        </div>
      </template>

      <template v-else-if="form.type === 'SHORT_ANSWER' || form.type === 'ESSAY'">
        <el-form-item :label="form.type === 'ESSAY' ? '评分要点' : '参考答案'">
          <el-input v-model="(form.content as any).rubric" type="textarea" :rows="3" placeholder="评分要点 / 参考答案，可含 $LaTeX$" />
        </el-form-item>
        <el-divider>小题（含多个小问时逐个填写，题型可改）</el-divider>
        <SubQuestionsEditor :model-value="form.content.subQuestions as SubQuestionEdit[]" show-type />
      </template>

      <!-- 阅读理解大题：小题列表（题型 + 题干 + 选项 + 正确项勾选） -->
      <template v-else-if="form.type === 'READING_COMPREHENSION'">
        <el-form-item label="阅读材料">
          <el-input v-model="(form.content as any).passage" type="textarea" :rows="8" placeholder="阅读材料全文（公式用 $...$ 包裹）" />
        </el-form-item>
        <el-divider>小题（选择 / 简答）</el-divider>
        <SubQuestionsEditor :model-value="form.content.subQuestions as SubQuestionEdit[]" show-type />
      </template>

      <!-- 材料题：小题列表（题干 + 参考答案） -->
      <template v-else-if="form.type === 'MATERIAL'">
        <el-divider>小题</el-divider>
        <SubQuestionsEditor :model-value="form.content.subQuestions as SubQuestionEdit[]" :show-type="false" />
      </template>

      <el-form-item label="解析（选填）">
        <el-input v-model="form.analysis" type="textarea" :rows="2" placeholder="可含 $LaTeX$" />
      </el-form-item>

      <el-form-item label="状态">
        <el-radio-group v-model="form.status">
          <el-radio value="DRAFT">草稿</el-radio>
          <el-radio value="PUBLISHED">已发布</el-radio>
          <el-radio value="ARCHIVED">归档</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="q-form__footer">
        <el-button v-if="isEdit" type="danger" plain @click="confirmDelete">删除</el-button>
        <div class="q-form__footer-right">
          <el-button @click="open = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.q-form__preview {
  margin: -12px 0 16px;
  padding: var(--space-3);
  background: var(--c-surface-2);
  border-radius: var(--radius-md);
  border: 1px solid var(--c-border);
}
.q-form__preview-label {
  display: block;
  font-size: 12px;
  color: var(--c-text-subtle);
  margin-bottom: 4px;
}
.q-blank {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}
.q-blank__idx { color: var(--c-text-muted); white-space: nowrap; }
.q-blank :deep(.el-input) { flex: 1; }
.q-form__footer { display: flex; justify-content: space-between; align-items: center; }
.q-form__footer-right { display: flex; gap: var(--space-2); }
.q-form__add-fig { padding: 0 4px; }
.q-form__figs { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.q-form__figs-label { font-size: 12px; color: var(--c-text-muted); }
.q-form__fig { width: 56px; height: 56px; object-fit: cover; border: 1px solid var(--c-border); border-radius: 6px; cursor: pointer; }
</style>
