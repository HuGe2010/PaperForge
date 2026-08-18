<script setup lang="ts">
/** 作业本层级节点（任意多级树形） */
export interface SectionNode {
  name: string;
  children?: SectionNode[];
}

defineOptions({ name: 'WorkbookSectionEditor' });

const props = defineProps<{ modelValue: SectionNode[] }>();
const emit = defineEmits<{ (e: 'change'): void }>();
const notify = () => emit('change');

function addRoot() {
  props.modelValue.push({ name: '', children: [] });
  notify();
}
function addChild(node: SectionNode) {
  if (!node.children) node.children = [];
  node.children.push({ name: '', children: [] });
  notify();
}
function removeAt(parent: SectionNode[], idx: number) {
  parent.splice(idx, 1);
  notify();
}
</script>

<template>
  <div class="wse">
    <div v-for="(node, i) in modelValue" :key="i" class="wse__node">
      <el-input v-model="node.name" size="small" placeholder="章节 / 次标题 / 次分区" @input="notify" />
      <el-button text type="primary" size="small" @click="addChild(node)">+子级</el-button>
      <el-button text type="danger" size="small" :icon="'Close'" @click="removeAt(modelValue, i)" />
      <WorkbookSectionEditor
        v-if="node.children && node.children.length"
        :model-value="node.children"
        @change="notify"
        class="wse__children"
      />
    </div>
    <el-button text type="primary" size="small" @click="addRoot">+ 章节</el-button>
  </div>
</template>

<style scoped>
.wse { display: flex; flex-direction: column; gap: var(--space-2); width: 100%; }
.wse__node { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.wse__node .el-input { flex: 1; min-width: 140px; }
.wse__children { margin-left: var(--space-6); border-left: 1px dashed var(--c-border); padding-left: var(--space-3); }
</style>
