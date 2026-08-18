# 智能试卷与试题整理系统

题库管理 · 智能组卷 · OCR/PDF 自动录题 · 在线考试 · 自动评分 · PDF/Word 导出

全栈式考试系统，前后端分离，Docker Compose 一键部署。核心特色是「拍照 / PDF 自动录题」：
导入图片或 PDF → 视觉模型识别 → 自动打标签 → 人工审阅台 → 入题库 → AI 解题 → 标知识点。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + Element Plus + Vite + TypeScript + UnoCSS + ECharts |
| 后端 | NestJS 11 + TypeScript + Prisma 5 |
| 数据库 | PostgreSQL 16（`pg_trgm` 扩展） |
| 缓存 / 队列 | Redis 7 + BullMQ 5 |
| 部署 | Docker Compose（源码本地 build，对外端口 9280） |

## 角色

- **管理员**：用户 / 角色 / 权限管理、系统设置（AI Key 配置）、全站数据
- **教师**：题库维护、智能组卷、试卷导出、发布考试、阅卷
- **学生**：在线答题、查看成绩与解析

## 快速开始（开发）

```bash
cp .env.example .env      # 按需修改数据库 / JWT 等
npm install               # 安装前后端依赖（workspace）
npm run prisma:generate   # 生成 Prisma Client
npm run prisma:migrate    # 执行数据库迁移
npm run prisma:seed       # 写入管理员 + 三角色 + 权限种子
npm run dev:backend       # 后端 :3000
npm run dev:frontend      # 前端 :5173
```

## 生产部署（Docker Compose）

```bash
cp .env.example .env
docker compose build
docker compose up -d
# 打开 http://<nas-ip>:9280
# 首次登录管理员账号见 seed 输出（默认 admin / Exam@2024!，请立即修改）
```

## 文档

- `docs/deploy.md` — 部署与备份
- `docs/api.md` — 接口约定
- `docs/import-template.md` — 批量导入模板与标记语法
- `docs/design-system.md` — 设计体系（设计令牌 / 主题 / 响应式）

## 目录结构

```
.
├── docker/                 # Dockerfile / nginx / 初始化 SQL / 字体子集
├── backend/                # NestJS 后端
│   ├── prisma/             # schema + 迁移 + 种子
│   └── src/modules/        # auth / users / questions / ingest / papers / exams / ...
├── frontend/               # Vue 3 前端
│   └── src/                # views / components / stores / api
└── docs/
```
