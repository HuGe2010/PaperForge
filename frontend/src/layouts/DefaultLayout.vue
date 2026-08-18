<template>
  <el-container class="layout">
    <!-- 桌面端侧边栏 -->
    <el-aside v-if="!isMobile" :width="collapsed ? '64px' : '232px'" class="layout__aside">
      <div class="layout__logo" :class="{ 'layout__logo--collapsed': collapsed }">
        <el-icon :size="22"><Notebook /></el-icon>
        <span v-if="!collapsed" class="layout__logo-text">试卷整理系统</span>
      </div>
      <el-scrollbar class="layout__menu-scroll">
        <el-menu
          :default-active="activeMenu"
          :collapse="collapsed"
          :collapse-transition="false"
          router
          class="layout__menu"
        >
          <el-menu-item :index="dashboardItem.path">
            <el-icon><component :is="dashboardItem.icon" /></el-icon>
            <template #title>{{ dashboardItem.title }}</template>
          </el-menu-item>

          <el-menu-item-group v-for="grp in visibleGroups" :key="grp.title">
            <template #title>{{ grp.title }}</template>
            <el-menu-item v-for="item in grp.children" :key="item.path" :index="item.path">
              <el-icon><component :is="item.icon" /></el-icon>
              <template #title>{{ item.title }}</template>
            </el-menu-item>
          </el-menu-item-group>
        </el-menu>
      </el-scrollbar>
    </el-aside>

    <!-- 移动端抽屉 -->
    <el-drawer
      v-model="drawerOpen"
      direction="ltr"
      size="232px"
      :with-header="false"
      class="layout__drawer"
    >
      <div class="layout__logo">
        <el-icon :size="22"><Notebook /></el-icon>
        <span class="layout__logo-text">试卷整理系统</span>
      </div>
      <el-menu :default-active="activeMenu" router class="layout__menu">
        <el-menu-item :index="dashboardItem.path">
          <el-icon><component :is="dashboardItem.icon" /></el-icon>
          <template #title>{{ dashboardItem.title }}</template>
        </el-menu-item>
        <el-menu-item-group v-for="grp in visibleGroups" :key="grp.title">
          <template #title>{{ grp.title }}</template>
          <el-menu-item v-for="item in grp.children" :key="item.path" :index="item.path">
            <el-icon><component :is="item.icon" /></el-icon>
            <template #title>
              <span>{{ item.title }}</span>
              <el-badge
                v-if="item.path === '/teacher/dedup' && dedupCount > 0"
                :value="dedupCount"
                :max="99"
                type="danger"
                class="layout__menu-badge"
              />
            </template>
          </el-menu-item>
        </el-menu-item-group>
      </el-menu>
    </el-drawer>

    <!-- 右侧主区 -->
    <el-container class="layout__main-wrap">
      <el-header class="layout__header">
        <div class="layout__header-left">
          <el-button text class="layout__hamburger" @click="onHamburger">
            <el-icon :size="20"><Menu /></el-icon>
          </el-button>
          <el-breadcrumb separator="/" class="layout__breadcrumb">
            <el-breadcrumb-item>首页</el-breadcrumb-item>
            <el-breadcrumb-item>{{ pageTitle }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="layout__header-right">
          <el-button text class="layout__theme" :aria-label="isDark ? '切换为亮色' : '切换为暗色'" @click="toggleTheme()">
            <el-icon :size="18"><component :is="isDark ? 'Sunny' : 'Moon'" /></el-icon>
          </el-button>
          <el-dropdown trigger="click" @command="onCommand">
            <span class="layout__user">
              <el-avatar :size="30" class="layout__avatar">{{ avatarText }}</el-avatar>
              <span class="layout__user-name">{{ auth.displayName }}</span>
              <el-tag v-if="roleLabel" size="small" effect="plain" type="primary">{{ roleLabel }}</el-tag>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">个人资料</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="layout__main">
        <router-view />
      </el-main>
    </el-container>

    <!-- 试卷/作业本浏览窗口（全局：题库按试卷/作业本、题目详情来源均从此打开） -->
    <PaperWindow />
    <WorkbookWindow />
  </el-container>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { useTheme } from '@/composables/useTheme';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { questionsApi } from '@/api/questions';
import PaperWindow from '@/components/biz/PaperWindow.vue';
import WorkbookWindow from '@/components/biz/WorkbookWindow.vue';

interface MenuChild { path: string; title: string; icon: string; roles: string[]; }
interface MenuGroup { title: string; roles: string[]; children: MenuChild[]; }

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const { isDark, toggleTheme } = useTheme();
const { isMobile } = useBreakpoint();

const collapsed = ref(false);
const drawerOpen = ref(false);

const dashboardItem: MenuChild = {
  path: '/dashboard',
  title: '数据看板',
  icon: 'DataLine',
  roles: ['ADMIN', 'TEACHER', 'STUDENT'],
};

const groups: MenuGroup[] = [
  {
    title: '教学管理',
    roles: ['ADMIN', 'TEACHER'],
    children: [
      { path: '/teacher/compose', title: '智能组卷', icon: 'SetUp', roles: ['ADMIN', 'TEACHER'] },
      { path: '/teacher/papers', title: '试卷管理', icon: 'Document', roles: ['ADMIN', 'TEACHER'] },
      { path: '/teacher/exams', title: '在线考试', icon: 'Timer', roles: ['ADMIN', 'TEACHER'] },
      { path: '/teacher/ingest', title: 'OCR 录题', icon: 'Camera', roles: ['ADMIN', 'TEACHER'] },
      { path: '/teacher/import', title: '批量导入', icon: 'Upload', roles: ['ADMIN', 'TEACHER'] },
    ],
  },
  {
    title: '题库管理',
    roles: ['ADMIN', 'TEACHER'],
    children: [
      { path: '/teacher/questions', title: '题库', icon: 'Collection', roles: ['ADMIN', 'TEACHER'] },
      { path: '/teacher/dedup', title: '题目查重', icon: 'Search', roles: ['ADMIN', 'TEACHER'] },
      { path: '/teacher/archive', title: '归档', icon: 'FolderChecked', roles: ['ADMIN', 'TEACHER'] },
    ],
  },
  {
    title: '学生端',
    roles: ['ADMIN', 'STUDENT'],
    children: [
      { path: '/student/exams', title: '我的考试', icon: 'Notebook', roles: ['ADMIN', 'STUDENT'] },
      { path: '/student/grades', title: '我的成绩', icon: 'Trophy', roles: ['ADMIN', 'STUDENT'] },
    ],
  },
  {
    title: '系统管理',
    roles: ['ADMIN'],
    children: [
      { path: '/admin/users', title: '用户与角色', icon: 'User', roles: ['ADMIN'] },
      { path: '/admin/subjects', title: '学科与知识点', icon: 'Reading', roles: ['ADMIN'] },
      { path: '/admin/tags', title: '标签管理', icon: 'PriceTag', roles: ['ADMIN'] },
      { path: '/admin/settings', title: '系统设置', icon: 'Setting', roles: ['ADMIN'] },
    ],
  },
];

function canSee(roles: string[]): boolean {
  return roles.some((r) => auth.roles.includes(r));
}

const visibleGroups = computed(() =>
  groups
    .filter((g) => canSee(g.roles))
    .map((g) => ({ ...g, children: g.children.filter((c) => canSee(c.roles)) }))
    .filter((g) => g.children.length > 0),
);

// 题目查重红点：未处理的疑似重复组数（挂载拉取；离开查重页刷新；并定时轮询）
const dedupCount = ref(0);
async function refreshDedupCount() {
  try {
    const r = await questionsApi.dedupCount();
    dedupCount.value = r.groups;
  } catch {
    /* 拦截器已提示 */
  }
}
onMounted(refreshDedupCount);
watch(
  () => route.path,
  (p) => {
    if (p !== '/teacher/dedup') refreshDedupCount();
  },
);
const dedupTimer = setInterval(refreshDedupCount, 60000);
onBeforeUnmount(() => clearInterval(dedupTimer));

const activeMenu = computed(() => route.path);
const pageTitle = computed(() => (route.meta.title as string) || '');
const avatarText = computed(() => (auth.displayName || 'U').slice(0, 1).toUpperCase());
const roleLabel = computed(() => {
  const map: Record<string, string> = { ADMIN: '管理员', TEACHER: '教师', STUDENT: '学生' };
  return auth.roles.map((r) => map[r] || r).join(' / ');
});

function onHamburger() {
  if (isMobile.value) drawerOpen.value = true;
  else collapsed.value = !collapsed.value;
}

function onCommand(cmd: string) {
  if (cmd === 'logout') auth.logout();
  else if (cmd === 'profile') ElMessage.info('个人资料模块将在后续阶段上线');
}
</script>

<style scoped>
.layout { height: 100vh; background: var(--c-bg); }

.layout__aside {
  background: var(--c-surface);
  border-right: 1px solid var(--c-border);
  transition: width var(--motion-base) var(--ease-out);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.layout__logo {
  height: 60px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-5);
  color: var(--c-primary);
  border-bottom: 1px solid var(--c-border);
  flex: 0 0 auto;
}
.layout__logo--collapsed { justify-content: center; padding: 0; }
.layout__logo-text { font-weight: 700; font-size: 15px; color: var(--c-text); white-space: nowrap; }
.layout__menu-scroll { flex: 1 1 auto; }
.layout__menu { border-right: none; }
.layout__menu-badge { margin-left: auto; }

.layout__main-wrap { display: flex; flex-direction: column; min-width: 0; }
.layout__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 60px;
  padding: 0 var(--space-5);
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
  flex: 0 0 auto;
}
.layout__header-left { display: flex; align-items: center; gap: var(--space-3); }
.layout__hamburger { color: var(--c-text-muted); }
.layout__breadcrumb { font-size: 14px; }

.layout__header-right { display: flex; align-items: center; gap: var(--space-3); }
.layout__theme { color: var(--c-text-muted); }
.layout__theme:hover { color: var(--c-primary); }
.layout__user { display: flex; align-items: center; gap: var(--space-2); cursor: pointer; outline: none; }
.layout__avatar { background: var(--c-primary); color: #fff; font-weight: 600; }
.layout__user-name { font-size: 14px; color: var(--c-text); }

.layout__main {
  background: var(--c-bg);
  padding: var(--space-6);
}

.layout__drawer :deep(.el-drawer__body) {
  padding: 0;
  display: flex;
  flex-direction: column;
}
.layout__drawer .layout__menu { border-right: none; flex: 1 1 auto; }

/* 菜单项：圆角悬浮 + hover + 选中态左侧主色条 */
.layout__menu :deep(.el-menu-item) {
  position: relative;
  height: 40px;
  line-height: 40px;
  border-radius: var(--radius-sm);
  margin: 2px var(--space-2);
}
.layout__menu :deep(.el-menu-item):hover {
  background: var(--c-surface-2);
  color: var(--c-primary);
}
.layout__menu :deep(.el-menu-item.is-active) {
  background: var(--c-primary-50);
  color: var(--c-primary);
  font-weight: 600;
}
.layout__menu :deep(.el-menu-item.is-active)::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 18px;
  border-radius: 2px;
  background: var(--c-primary);
}
/* 分组标题：小号、字距、弱化 */
.layout__menu :deep(.el-menu-item-group__title) {
  padding: var(--space-4) var(--space-3) var(--space-2);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--c-text-subtle);
}
/* logo 图标加浅色底，提升精致感 */
.layout__logo :deep(.el-icon) {
  background: var(--c-primary-50);
  color: var(--c-primary);
  border-radius: var(--radius-sm);
  padding: 5px;
}
</style>
