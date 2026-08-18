<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import {
  questionsApi,
  type DedupGroup,
  type DedupIgnoredGroup,
  type DedupQuestion,
} from '@/api/questions';
import { QUESTION_TYPE_LABEL } from '@/types/models';
import MathText from '@/components/base/MathText.vue';

const loading = ref(false);
const backfilling = ref(false);
const showIgnored = ref(false);
const groups = ref<DedupGroup[]>([]);
const ignored = ref<DedupIgnoredGroup[]>([]);
const kept = reactive<Record<string, string>>({});
const recentMerges = ref<{ mergeId: string; keptId: string; archived: string[] }[]>([]);

function cropIdOf(p?: string | null): string | null {
  if (!p || !/crops\//i.test(p)) return null;
  const base = p.split(/[\\/]/).pop() || '';
  const m = /^(.+)\.(png|jpe?g)$/i.exec(base);
  return m ? m[1] : null;
}
function typeLabel(t: string): string {
  return (QUESTION_TYPE_LABEL as Record<string, string>)[t] || t;
}
function thumb(q: DedupQuestion): string | null {
  const c = cropIdOf(q.sourceImagePath);
  return c ? questionsApi.figureUrl(c) : null;
}
function keptOf(g: DedupGroup): string {
  return kept[g.id] || g.questions[0]?.id || '';
}

async function load() {
  loading.value = true;
  try {
    if (showIgnored.value) {
      ignored.value = await questionsApi.dedupIgnored();
      groups.value = [];
    } else {
      groups.value = await questionsApi.dedupGroups();
      ignored.value = [];
      for (const g of groups.value) if (!kept[g.id]) kept[g.id] = g.questions[0]?.id;
    }
  } catch {
    /* 拦截器已提示 */
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function mergeGroup(g: DedupGroup) {
  const keptId = keptOf(g);
  const absorbed = g.questions.filter((q) => q.id !== keptId).map((q) => q.id);
  if (!absorbed.length) {
    ElMessage.warning('请至少选择一道要合并的题');
    return;
  }
  try {
    const r = await questionsApi.merge(keptId, absorbed);
    recentMerges.value.unshift({ mergeId: r.mergeId, keptId: r.keptId, archived: r.archived });
    ElMessage.success(`已合并 ${absorbed.length} 题，被合并题已归档（可撤销）`);
    await load();
  } catch {
    /* 拦截器已提示 */
  }
}

async function ignoreWhole(g: DedupGroup) {
  try {
    await questionsApi.ignoreGroup(g.questions.map((q) => q.id));
    ElMessage.success('已忽略该组（可撤销）');
    await load();
  } catch {
    /* 拦截器已提示 */
  }
}

async function ignoreOne(g: DedupGroup, otherId: string) {
  const keptId = keptOf(g);
  if (otherId === keptId) return;
  try {
    await questionsApi.ignorePair(keptId, otherId);
    ElMessage.success('已忽略该对（可撤销）');
    await load();
  } catch {
    /* 拦截器已提示 */
  }
}

async function unignore(id: string) {
  try {
    await questionsApi.unignore(id);
    ElMessage.success('已撤销忽略');
    await load();
  } catch {
    /* 拦截器已提示 */
  }
}

async function undoRecent(m: { mergeId: string }) {
  try {
    await questionsApi.undoMerge(m.mergeId);
    recentMerges.value = recentMerges.value.filter((x) => x.mergeId !== m.mergeId);
    ElMessage.success('已撤销合并');
    await load();
  } catch {
    /* 拦截器已提示 */
  }
}

// 回填存量题目语义向量（需先在「系统设置」配置 LLM 密钥，embedding 模型默认 qwen3.7-text-embedding）
async function runBackfill() {
  backfilling.value = true;
  try {
    const r = await questionsApi.backfill();
    ElMessage.success(`语义向量生成完成：扫描 ${r.total} 题，新增/更新 ${r.generated} 题`);
    await load();
  } catch {
    /* 拦截器已提示 */
  } finally {
    backfilling.value = false;
  }
}
</script>

<template>
  <div class="dedup">
    <div class="dedup__head">
      <h2 class="dedup__title">题目查重</h2>
      <div class="dedup__head-actions">
        <el-tooltip
          content="需先在「系统设置」配置 LLM 密钥（embedding 模型默认 qwen3.7-text-embedding）。生成后查重页会额外按语义相似召回「同义不同词」的题目。"
          placement="bottom"
        >
          <el-button :loading="backfilling" :disabled="showIgnored" @click="runBackfill">
            生成语义向量
          </el-button>
        </el-tooltip>
        <el-switch
          v-model="showIgnored"
          active-text="已忽略"
          inactive-text="未处理"
          @change="load"
        />
      </div>
    </div>

    <el-alert
      v-if="recentMerges.length"
      type="success"
      :closable="false"
      class="dedup__recent"
    >
      <template #title>
        <span>近期合并：</span>
        <span v-for="m in recentMerges" :key="m.mergeId" class="dedup__recent-item">
          {{ m.archived.length }} 题 → 主保留题
          <el-button link type="primary" size="small" @click="undoRecent(m)">撤销</el-button>
        </span>
      </template>
    </el-alert>

    <div v-loading="loading">
      <el-empty v-if="!loading && !showIgnored && !groups.length" description="未检测到疑似重复题目" />
      <el-empty v-if="!loading && showIgnored && !ignored.length" description="没有已忽略的重复组" />

      <template v-if="!showIgnored">
        <el-card v-for="g in groups" :key="g.id" class="dedup__group" shadow="hover">
          <template #header>
            <div class="dedup__group-head">
              <span>
                疑似重复 · 文本相似 {{ Math.round(g.similarity * 100) }}%
                <template v-if="g.semanticSimilarity !== null">
                  · 语义相似 {{ Math.round(g.semanticSimilarity * 100) }}%
                </template>
              </span>
              <span class="dedup__group-count">{{ g.questions.length }} 题</span>
            </div>
          </template>
          <div class="dedup__list">
            <div
              v-for="q in g.questions"
              :key="q.id"
              class="dedup__item"
              :class="{ 'is-kept': keptOf(g) === q.id }"
            >
              <el-radio-group :model-value="keptOf(g)" @update:model-value="(v: any) => (kept[g.id] = v)">
                <el-radio :value="q.id">保留</el-radio>
              </el-radio-group>
              <div class="dedup__item-body">
                <div class="dedup__item-meta">
                  <el-tag size="small">{{ typeLabel(q.type) }}</el-tag>
                  <span class="dedup__stem"><MathText :value="q.stem" /></span>
                </div>
                <div class="dedup__item-papers">
                  <el-tag
                    v-for="p in q.sourcePapers"
                    :key="p"
                    size="small"
                    type="info"
                    effect="plain"
                  >{{ p }}</el-tag>
                </div>
                <div class="dedup__item-foot">
                  <el-image
                    v-if="thumb(q)"
                    :src="thumb(q)!"
                    class="dedup__thumb"
                    fit="contain"
                  />
                  <el-button
                    v-if="keptOf(g) !== q.id"
                    link
                    type="info"
                    size="small"
                    @click="ignoreOne(g, q.id)"
                  >忽略此对</el-button>
                </div>
              </div>
            </div>
          </div>
          <div class="dedup__actions">
            <el-button type="primary" @click="mergeGroup(g)">合并（选中题为母题）</el-button>
            <el-button @click="ignoreWhole(g)">整组忽略</el-button>
          </div>
        </el-card>
      </template>

      <template v-else>
        <el-card v-for="g in ignored" :key="g.ignoreId" class="dedup__group" shadow="hover">
          <template #header>
            <div class="dedup__group-head">
              <span>已忽略（{{ g.kind === 'GROUP' ? '整组' : '逐对' }}）</span>
              <el-button link type="primary" size="small" @click="unignore(g.ignoreId)">
                撤销忽略
              </el-button>
            </div>
          </template>
          <div class="dedup__list">
            <div v-for="q in g.questions" :key="q.id" class="dedup__item">
              <div class="dedup__item-body">
                <div class="dedup__item-meta">
                  <el-tag size="small">{{ typeLabel(q.type) }}</el-tag>
                  <span class="dedup__stem"><MathText :value="q.stem" /></span>
                </div>
                <div class="dedup__item-papers">
                  <el-tag
                    v-for="p in q.sourcePapers"
                    :key="p"
                    size="small"
                    type="info"
                    effect="plain"
                  >{{ p }}</el-tag>
                </div>
              </div>
            </div>
          </div>
        </el-card>
      </template>
    </div>
  </div>
</template>

<style scoped>
.dedup { padding: var(--space-5); max-width: 1080px; margin: 0 auto; }
.dedup__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-4); }
.dedup__head-actions { display: flex; align-items: center; gap: var(--space-3); }
.dedup__title { margin: 0; font-size: 20px; }
.dedup__recent { margin-bottom: var(--space-4); }
.dedup__recent-item { margin-right: var(--space-4); }
.dedup__group { margin-bottom: var(--space-4); }
.dedup__group-head { display: flex; align-items: center; justify-content: space-between; font-weight: 600; }
.dedup__group-count { color: var(--el-text-color-secondary); font-weight: 400; font-size: 13px; }
.dedup__list { display: flex; flex-direction: column; gap: var(--space-2); }
.dedup__item {
  display: flex; gap: var(--space-3); align-items: flex-start;
  padding: var(--space-3); border: 1px solid var(--el-border-color-lighter); border-radius: 8px;
}
.dedup__item.is-kept { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.dedup__item-body { flex: 1; min-width: 0; }
.dedup__item-meta { display: flex; gap: var(--space-2); align-items: flex-start; }
.dedup__stem { flex: 1; min-width: 0; }
.dedup__item-papers { margin-top: var(--space-2); display: flex; flex-wrap: wrap; gap: 4px; }
.dedup__item-foot { margin-top: var(--space-2); display: flex; align-items: center; gap: var(--space-3); }
.dedup__thumb { width: 96px; height: 72px; border-radius: 6px; border: 1px solid var(--el-border-color-lighter); background: var(--el-fill-color-light); }
.dedup__actions { margin-top: var(--space-3); display: flex; gap: var(--space-2); }
</style>
