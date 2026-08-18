import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/login/LoginView.vue'),
    meta: { public: true, title: '登录' },
  },
  {
    path: '/',
    component: () => import('../layouts/DefaultLayout.vue'),
    children: [
      { path: '', redirect: { name: 'dashboard' } },
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('../views/admin/DashboardView.vue'),
        meta: { title: '数据看板', icon: 'DataLine', roles: ['ADMIN', 'TEACHER', 'STUDENT'] },
      },
      // ---- 教师 / 管理员：教学管理 ----
      {
        path: 'teacher/questions',
        name: 'teacher-questions',
        component: () => import('../views/teacher/QuestionListView.vue'),
        meta: { title: '题库管理', icon: 'Collection', roles: ['ADMIN', 'TEACHER'] },
      },
      {
        path: 'teacher/questions/:id',
        name: 'teacher-question-detail',
        component: () => import('../views/teacher/QuestionDetailView.vue'),
        meta: { title: '题目详情', icon: 'Collection', roles: ['ADMIN', 'TEACHER'] },
      },
      {
        path: 'teacher/dedup',
        name: 'teacher-dedup',
        component: () => import('../views/teacher/DedupView.vue'),
        meta: { title: '题目查重', icon: 'Search', roles: ['ADMIN', 'TEACHER'] },
      },
      {
        path: 'teacher/archive',
        name: 'teacher-archive',
        component: () => import('../views/teacher/ArchiveView.vue'),
        meta: { title: '归档', icon: 'FolderChecked', roles: ['ADMIN', 'TEACHER'] },
      },
      {
        path: 'teacher/compose',
        name: 'teacher-compose',
        component: () => import('../views/teacher/ComposerView.vue'),
        meta: { title: '智能组卷', icon: 'SetUp', roles: ['ADMIN', 'TEACHER'] },
      },
      {
        path: 'teacher/papers',
        name: 'teacher-papers',
        component: () => import('../views/error/ComingSoon.vue'),
        meta: { title: '试卷管理', icon: 'Document', roles: ['ADMIN', 'TEACHER'] },
      },
      {
        path: 'teacher/exams',
        name: 'teacher-exams',
        component: () => import('../views/error/ComingSoon.vue'),
        meta: { title: '在线考试', icon: 'Timer', roles: ['ADMIN', 'TEACHER'] },
      },
      {
        path: 'teacher/ingest',
        name: 'teacher-ingest',
        component: () => import('../views/teacher/IngestView.vue'),
        meta: { title: 'OCR 录题', icon: 'Camera', roles: ['ADMIN', 'TEACHER'] },
      },
      {
        path: 'teacher/import',
        name: 'teacher-import',
        component: () => import('../views/error/ComingSoon.vue'),
        meta: { title: '批量导入', icon: 'Upload', roles: ['ADMIN', 'TEACHER'] },
      },
      // ---- 学生端 ----
      {
        path: 'student/exams',
        name: 'student-exams',
        component: () => import('../views/error/ComingSoon.vue'),
        meta: { title: '我的考试', icon: 'Notebook', roles: ['ADMIN', 'STUDENT'] },
      },
      {
        path: 'student/grades',
        name: 'student-grades',
        component: () => import('../views/error/ComingSoon.vue'),
        meta: { title: '我的成绩', icon: 'Trophy', roles: ['ADMIN', 'STUDENT'] },
      },
      // ---- 系统（管理员）----
      {
        path: 'admin/users',
        name: 'admin-users',
        component: () => import('../views/error/ComingSoon.vue'),
        meta: { title: '用户与角色', icon: 'User', roles: ['ADMIN'] },
      },
      {
        path: 'admin/subjects',
        name: 'admin-subjects',
        component: () => import('../views/admin/SubjectManageView.vue'),
        meta: { title: '学科与知识点', icon: 'Reading', roles: ['ADMIN'] },
      },
      {
        path: 'admin/tags',
        name: 'admin-tags',
        component: () => import('../views/admin/TagManageView.vue'),
        meta: { title: '标签管理', icon: 'PriceTag', roles: ['ADMIN'] },
      },
      {
        path: 'admin/settings',
        name: 'admin-settings',
        component: () => import('../views/admin/SettingsView.vue'),
        meta: { title: '系统设置', icon: 'Setting', roles: ['ADMIN'] },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'notfound',
    component: () => import('../views/error/NotFoundView.vue'),
    meta: { title: '页面不存在' },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (to.meta.public) return true;
  if (!auth.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (!auth.user) {
    try {
      await auth.fetchMe();
    } catch {
      return { name: 'login' };
    }
  }
  return true;
});

export default router;
