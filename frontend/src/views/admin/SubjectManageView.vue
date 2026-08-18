<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { subjectsApi, type CreateSubjectPayload } from '../../api/subjects';
import { knowledgeApi, type CreateKnowledgePayload } from '../../api/knowledge';
import type { Subject, KnowledgePoint } from '../../types/models';

const loading = ref(false);
const subjects = ref<Subject[]>([]);

async function load() {
  loading.value = true;
  try {
    subjects.value = (await subjectsApi.tree()) as unknown as Subject[];
  } catch {
    /* 拦截器已提示 */
  } finally {
    loading.value = false;
  }
}

function flatKp(sub: Subject): KnowledgePoint[] {
  return (sub.knowledgePoints || []) as unknown as KnowledgePoint[];
}

// 学科新建/编辑
const subDialog = ref(false);
const subForm = ref<CreateSubjectPayload & { id?: string; parentId?: string }>({ name: '' });
const subSaving = ref(false);
function openNewSubject(parentId?: string) {
  subForm.value = { name: '', parentId };
  subDialog.value = true;
}
function openEditSubject(sub: Subject) {
  subForm.value = { id: sub.id, name: sub.name, code: sub.code || '', description: sub.description || '', parentId: sub.parentId || undefined };
  subDialog.value = true;
}
async function saveSubject() {
  if (!subForm.value.name.trim()) return ElMessage.warning('请填写名称');
  subSaving.value = true;
  try {
    if (subForm.value.id) await subjectsApi.update(subForm.value.id, subForm.value);
    else await subjectsApi.create(subForm.value);
    ElMessage.success('已保存');
    subDialog.value = false;
    load();
  } catch {
    /* 拦截器已提示 */
  } finally {
    subSaving.value = false;
  }
}
async function deleteSubject(sub: Subject) {
  try {
    await ElMessageBox.confirm(`删除学科「${sub.name}」？其下子学科与知识点将一并处理。`, '确认删除', { type: 'warning' });
    await subjectsApi.remove(sub.id);
    ElMessage.success('已删除');
    load();
  } catch {
    /* cancel */
  }
}

// 知识点新建
const kpDialog = ref(false);
const kpForm = ref<CreateKnowledgePayload & { id?: string }>({ subjectId: '', name: '' });
const kpSaving = ref(false);
function openNewKp(subjectId: string) {
  kpForm.value = { subjectId, name: '' };
  kpDialog.value = true;
}
async function saveKp() {
  if (!kpForm.value.name.trim()) return ElMessage.warning('请填写知识点名称');
  kpSaving.value = true;
  try {
    await knowledgeApi.create(kpForm.value);
    ElMessage.success('已添加知识点');
    kpDialog.value = false;
    load();
  } catch {
    /* 拦截器已提示 */
  } finally {
    kpSaving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="sub-manage">
    <div class="sub-manage__head">
      <h2 class="sub-manage__title">学科与知识点</h2>
      <el-button type="primary" :icon="'Plus'" @click="openNewSubject()">新建学科</el-button>
    </div>

    <el-skeleton v-if="loading" :rows="6" animated />
    <div v-else class="sub-manage__tree">
      <el-card v-for="sub in subjects" :key="sub.id" shadow="never" class="sub-manage__card">
        <template #header>
          <div class="sub-manage__card-head">
            <span class="sub-manage__name">{{ sub.name }} <small v-if="sub.code" class="sub-manage__code">{{ sub.code }}</small></span>
            <div>
              <el-button text type="primary" :icon="'Plus'" @click="openNewKp(sub.id)">知识点</el-button>
              <el-button text type="primary" :icon="'Edit'" @click="openEditSubject(sub)" />
              <el-button text type="danger" :icon="'Delete'" @click="deleteSubject(sub)" />
            </div>
          </div>
        </template>
        <div v-if="flatKp(sub).length" class="sub-manage__kp">
          <el-tag
            v-for="kp in flatKp(sub)"
            :key="kp.id"
            class="sub-manage__kp-tag"
            effect="plain"
          >{{ '　'.repeat(kp.level - 1) }}{{ kp.name }} <small class="sub-manage__kp-count">({{ kp.questionCount }})</small></el-tag>
        </div>
        <p v-else class="sub-manage__empty">暂无知识点，点击「知识点」添加</p>
        <div v-if="sub.children?.length" class="sub-manage__children">
          <span class="sub-manage__child" v-for="c in sub.children" :key="c.id">
            <el-icon><Folder /></el-icon> {{ c.name }}
            <el-button text type="primary" :icon="'Edit'" size="small" @click="openEditSubject(c)" />
          </span>
        </div>
      </el-card>
    </div>

    <!-- 学科对话框 -->
    <el-dialog v-model="subDialog" :title="subForm.id ? '编辑学科' : '新建学科'" width="420px">
      <el-form label-position="top">
        <el-form-item label="名称"><el-input v-model="subForm.name" /></el-form-item>
        <el-form-item label="编码"><el-input v-model="subForm.code" placeholder="如 MATH（选填）" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="subForm.description" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="subDialog = false">取消</el-button>
        <el-button type="primary" :loading="subSaving" @click="saveSubject">保存</el-button>
      </template>
    </el-dialog>

    <!-- 知识点对话框 -->
    <el-dialog v-model="kpDialog" title="新建知识点" width="420px">
      <el-form label-position="top">
        <el-form-item label="名称"><el-input v-model="kpForm.name" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="kpDialog = false">取消</el-button>
        <el-button type="primary" :loading="kpSaving" @click="saveKp">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.sub-manage__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-4); }
.sub-manage__title { font-size: 18px; font-weight: 700; margin: 0; }
.sub-manage__tree { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--space-4); }
.sub-manage__card-head { display: flex; justify-content: space-between; align-items: center; }
.sub-manage__name { font-weight: 600; }
.sub-manage__code { color: var(--c-text-subtle); font-weight: 400; margin-left: 6px; }
.sub-manage__kp { display: flex; flex-wrap: wrap; gap: 6px; }
.sub-manage__kp-count { color: var(--c-text-subtle); }
.sub-manage__empty { color: var(--c-text-subtle); font-size: 13px; margin: 0; }
.sub-manage__children { margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px dashed var(--c-border); display: flex; flex-direction: column; gap: 4px; }
.sub-manage__child { display: flex; align-items: center; gap: 4px; color: var(--c-text-muted); font-size: 13px; }
</style>
