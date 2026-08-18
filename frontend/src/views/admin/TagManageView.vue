<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { tagsApi, type CreateTagPayload } from '../../api/tags';
import type { Tag } from '../../types/models';

const loading = ref(false);
const tags = ref<Tag[]>([]);
const dialog = ref(false);
const form = ref<CreateTagPayload & { id?: string }>({ name: '' });
const saving = ref(false);

async function load() {
  loading.value = true;
  try {
    tags.value = (await tagsApi.list()) as unknown as Tag[];
  } catch {
    /* 拦截器已提示 */
  } finally {
    loading.value = false;
  }
}
function openNew() {
  form.value = { name: '', group: '' };
  dialog.value = true;
}
function openEdit(t: Tag) {
  form.value = { id: t.id, name: t.name, group: t.group || '' };
  dialog.value = true;
}
async function save() {
  if (!form.value.name.trim()) return ElMessage.warning('请填写名称');
  saving.value = true;
  try {
    if (form.value.id) await tagsApi.update(form.value.id, form.value);
    else await tagsApi.create(form.value);
    ElMessage.success('已保存');
    dialog.value = false;
    load();
  } catch {
    /* 拦截器已提示 */
  } finally {
    saving.value = false;
  }
}
async function remove(t: Tag) {
  try {
    await ElMessageBox.confirm(`删除标签「${t.name}」？`, '确认删除', { type: 'warning' });
    await tagsApi.remove(t.id);
    ElMessage.success('已删除');
    load();
  } catch {
    /* cancel */
  }
}

onMounted(load);
</script>

<template>
  <div class="tag-manage">
    <div class="tag-manage__head">
      <h2 class="tag-manage__title">标签管理</h2>
      <el-button type="primary" @click="openNew">新建标签</el-button>
    </div>
    <el-skeleton v-if="loading" :rows="4" animated />
    <div v-else class="tag-manage__list">
      <el-table :data="tags" stripe border>
        <el-table-column prop="name" label="名称" />
        <el-table-column prop="group" label="分组" />
        <el-table-column label="使用数" width="100">
          <template #default="{ row }">{{ row._count?.questions ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button text type="primary" :icon="'Edit'" @click="openEdit(row as Tag)" />
            <el-button text type="danger" :icon="'Delete'" @click="remove(row as Tag)" />
          </template>
        </el-table-column>
        <template #empty>暂无标签</template>
      </el-table>
    </div>

    <el-dialog v-model="dialog" :title="form.id ? '编辑标签' : '新建标签'" width="400px">
      <el-form label-position="top">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="分组"><el-input v-model="form.group" placeholder="选填，如 章节/难度" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.tag-manage__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-4); }
.tag-manage__title { font-size: 18px; font-weight: 700; margin: 0; }
</style>
