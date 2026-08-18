import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// 权限目录（code / 名称 / 分组）
const PERMISSIONS: { code: string; name: string; group: string }[] = [
  { code: 'dashboard:read', name: '查看数据看板', group: '看板' },
  { code: 'user:read', name: '查看用户', group: '用户管理' },
  { code: 'user:create', name: '创建用户', group: '用户管理' },
  { code: 'user:update', name: '编辑用户', group: '用户管理' },
  { code: 'user:delete', name: '删除用户', group: '用户管理' },
  { code: 'role:read', name: '查看角色', group: '权限管理' },
  { code: 'role:create', name: '创建角色', group: '权限管理' },
  { code: 'role:update', name: '编辑角色', group: '权限管理' },
  { code: 'role:delete', name: '删除角色', group: '权限管理' },
  { code: 'subject:read', name: '查看学科', group: '题库' },
  { code: 'subject:create', name: '创建学科', group: '题库' },
  { code: 'subject:update', name: '编辑学科', group: '题库' },
  { code: 'subject:delete', name: '删除学科', group: '题库' },
  { code: 'knowledge:read', name: '查看知识点', group: '题库' },
  { code: 'knowledge:create', name: '创建知识点', group: '题库' },
  { code: 'knowledge:update', name: '编辑知识点', group: '题库' },
  { code: 'knowledge:delete', name: '删除知识点', group: '题库' },
  { code: 'tag:read', name: '查看标签', group: '题库' },
  { code: 'tag:create', name: '创建标签', group: '题库' },
  { code: 'tag:update', name: '编辑标签', group: '题库' },
  { code: 'tag:delete', name: '删除标签', group: '题库' },
  { code: 'question:read', name: '查看试题', group: '题库' },
  { code: 'question:create', name: '录入试题', group: '题库' },
  { code: 'question:update', name: '编辑试题', group: '题库' },
  { code: 'question:delete', name: '删除试题', group: '题库' },
  { code: 'question:review', name: '审阅 OCR 录题', group: '题库' },
  { code: 'question:import', name: '批量导入试题', group: '题库' },
  { code: 'paper:read', name: '查看试卷', group: '试卷' },
  { code: 'paper:create', name: '组卷', group: '试卷' },
  { code: 'paper:update', name: '编辑试卷', group: '试卷' },
  { code: 'paper:delete', name: '删除试卷', group: '试卷' },
  { code: 'paper:export', name: '导出试卷', group: '试卷' },
  { code: 'exam:read', name: '查看考试', group: '考试' },
  { code: 'exam:create', name: '创建考试', group: '考试' },
  { code: 'exam:update', name: '编辑考试', group: '考试' },
  { code: 'exam:delete', name: '删除考试', group: '考试' },
  { code: 'exam:publish', name: '发布考试', group: '考试' },
  { code: 'exam:grade', name: '阅卷', group: '考试' },
  { code: 'grading:read', name: '查看批改', group: '考试' },
  { code: 'grading:ai_config', name: '配置 AI 评分', group: '考试' },
  { code: 'setting:read', name: '查看系统设置', group: '系统' },
  { code: 'setting:update', name: '修改系统设置', group: '系统' },
  { code: 'ingest:read', name: '查看录题任务', group: '题库' },
  { code: 'ingest:create', name: '创建录题任务', group: '题库' },
  { code: 'ingest:process', name: '处理录题任务', group: '题库' },
];

const ADMIN_PERMS = PERMISSIONS.map((p) => p.code);
const TEACHER_PERMS = ADMIN_PERMS.filter(
  (c) =>
    !c.startsWith('user:') &&
    !c.startsWith('role:') &&
    c !== 'setting:update' &&
    c !== 'question:delete',
);
const STUDENT_PERMS = ['dashboard:read', 'exam:read'];

async function main() {
  console.log('▶ 开始种子数据写入...');

  // 1) 权限
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { name: p.name, group: p.group },
      create: p,
    });
  }
  console.log(`  ✓ 权限 ${PERMISSIONS.length} 条`);

  const allPerms = await prisma.permission.findMany();
  const permByCode = new Map(allPerms.map((p) => [p.code, p.id]));

  // 2) 角色 + 权限关联
  const roles = [
    { code: 'ADMIN', name: '管理员', perms: ADMIN_PERMS },
    { code: 'TEACHER', name: '教师', perms: TEACHER_PERMS },
    { code: 'STUDENT', name: '学生', perms: STUDENT_PERMS },
  ];
  for (const r of roles) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, isSystem: true },
      create: { code: r.code, name: r.name, isSystem: true },
    });
    // 重建权限关联
    await prisma.role.update({
      where: { id: role.id },
      data: {
        permissions: {
          set: r.perms.map((code) => ({ id: permByCode.get(code)! })),
        },
      },
    });
    console.log(`  ✓ 角色 ${r.code}（${r.perms.length} 权限）`);
  }

  // 3) 管理员账号
  const adminRole = await prisma.role.findUnique({ where: { code: 'ADMIN' } });
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Exam@2024!';
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: { passwordHash, status: 'ACTIVE' },
    create: {
      username: 'admin',
      name: '系统管理员',
      passwordHash,
      status: 'ACTIVE',
      roles: { connect: { id: adminRole!.id } },
    },
  });
  console.log('  ✓ 管理员账号 admin 就绪（请登录后立即修改密码）');

  // 4) 默认学科（语数英物化生政史地，共 9 门）
  const SUBJECTS = [
    { code: 'chinese', name: '语文' },
    { code: 'math', name: '数学' },
    { code: 'english', name: '英语' },
    { code: 'physics', name: '物理' },
    { code: 'chemistry', name: '化学' },
    { code: 'biology', name: '生物' },
    { code: 'politics', name: '政治' },
    { code: 'history', name: '历史' },
    { code: 'geography', name: '地理' },
  ];
  for (const s of SUBJECTS) {
    await prisma.subject.upsert({
      where: { code: s.code },
      update: { name: s.name },
      create: { code: s.code, name: s.name },
    });
  }
  console.log(`  ✓ 学科 ${SUBJECTS.length} 门`);

  console.log('✅ 种子数据写入完成');
}

main()
  .catch((e) => {
    console.error('种子写入失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
