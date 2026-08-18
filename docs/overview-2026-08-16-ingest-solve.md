# 录入任务解耦 AI 解答 + 审阅台重排

> 日期：2026-08-16 ｜ 范围：OCR 录题流水线、题库求解、审阅台 UI

## 一、本次改了什么

### 1. 录入任务不再「先解答」，解答统一放到「入库后」
- `backend/src/modules/ingest/ingest.service.ts`
  - `recognize`（步骤 4 AI 识别）**不再存储 VLM 返回的 `analysis`**（这就是之前"录入时就被解答"的源头）。录任务现在只做：识别题目文本 + 标注题型/学科/知识点。
  - `approveItem`（入库）**移除** `void this.solveInBackground(...)` 自动求解调用，并删除了已无用的私有方法 `solveInBackground` 及 `llm` 依赖注入。
- 新增「入库后统一求解」端点（解答彻底从录入流程剥离）：
  - `questions.module.ts` 引入 `LlmModule`。
  - `questions.service.ts` 新增 `solveQuestion(id)`：加载题目 → 调 `llm.solve` → 写回 `analysis / solution / llmModel / aiGenerated`。
  - `questions.controller.ts` 新增 `POST /api/questions/:id/solve`（TEACHER/ADMIN）。
- `llm.service.ts` 的 `fetch` 增加 `AbortController` **60s 超时**，LLM 不可达时快速失败返回 `null`，避免按钮长时间挂起。

### 2. 题库详情页加「生成 AI 解答」按钮
- `frontend/src/api/questions.ts` 增加 `solve(id)`。
- `frontend/src/views/teacher/QuestionDetailView.vue` 顶部加「生成 AI 解答」按钮（`MagicStick` 图标），点击后调用端点并刷新；未配置文本模型密钥时给出明确提示。

### 3. 审阅台重排：原图对照 + 紧凑编辑 + 输入框手输公式
- `frontend/src/views/teacher/IngestView.vue`
  - 每张题卡改为 **左原图（按 bbox 红框高亮题区）+ 右紧凑编辑表单** 的左右对照布局（`review__row` flex，窄屏自动堆叠）。
  - 按 `pageId` 缓存页面图到 `pageImageMap`，关闭时 `revokeObjectURL` 防泄漏。
  - **题干**升级为醒目输入框（`el-input` textarea）+ `$...$` 包裹公式提示 + 实时 `MathText` 公式预览。
  - 流程步骤去掉「后台 AI 解答」，改为「入库（解答在题库生成）」；批准提示同步更新。
  - 修复：`pageImageMap[item.pageId]` 的 `pageId` 为 `string|null` → 用 `?? ''` 兜底（否则 `vue-tsc` 报 TS2538）。

## 二、关键决策
- 解答从"录入任务自动触发"改为"题库侧显式触发"，严格对应用户"录入只识别+标学科、解答统一放入库后"的诉求。
- `solveQuestion` 复用既有 `LlmService`，不引入新依赖；端点与现有鉴权/角色体系一致。
- 题干输入框 + 实时预览，既满足"手输公式"，又延续此前已修好的 KaTeX 渲染（按 `$...$`/`$$...$$` 切分、文本段转义、公式段原样送 KaTeX）。

## 三、验证结果
- `docker compose up -d --build`（putout/ 部署包）构建成功，4 容器均 running。
- `/api/health`：database / redis 均 `up`；`http://localhost:9280/` → 200。
- 新路由 `POST /api/questions/:id/solve` 已注册；实测返回 **201**（沙箱无 DashScope 外网，被 60s 兜底快速拒绝 → 返回 null，无崩溃/挂起）。
- 类型检查：前端 `vue-tsc` 通过；后端 `nest build` 通过（两处 `string|null` 兜底已修）。

## 四、给用户的后续操作
- NAS 上若仅改了前端/后端，需**完整重建**：`docker compose stop backend frontend && docker compose up -d --build`（在 putout/ 目录）。
- 想真正生成解答：在「系统设置 → 文本模型」填好密钥（已支持），再到题库题目详情页点「生成 AI 解答」。
- 登录 admin / `Exam@2024!`。
