# 代码审查标准与流程（题汇 · PaperForge）

> 用途：本仓库所有代码改动（后端 NestJS / 前端 Vue3 / OCR 服务 / 部署配置）合入前的**强制性审查依据**。
> 配套规范：`docs/design-system.md`（前端设计体系）、`docs/api.md`（接口约定）、`docs/bug-fix-plan-2026-08-17.md`（历史修复记录）。
> 维护者：技术负责人。每次重大调整在文末「修订记录」追加。

---

## 0. 适用范围

- 所有进入 `main`（或约定主干）的 PR/MR。
- 含：新增功能、缺陷修复、重构、依赖升级、数据库迁移、Docker/compose/CI 配置变更。
- 不涉及：纯文档（`.md`）、一次性脚本（标注 `// 一次性` 且不在 `src/` 内）。

---

## 1. 现状诊断（为什么必须建立这套机制）

| 维度 | 现状（2026-08-17 实测） | 风险 |
|---|---|---|
| 静态检查 | 全仓库**无任何项目级 ESLint/Prettier/Stylelint** 配置；后端 `lint` 脚本因缺 flat config 实际跑不起来；前端无 lint 脚本 | 风格/明显错误无自动拦截，质量完全靠个人自觉 |
| 单元测试 | 测试文件数 **= 0**（前后端均无） | 核心逻辑（鉴权、录题状态机、去重、题型归一化）回归无保障 |
| 提交门禁 | 无 husky / lint-staged / commitlint / CI | 坏代码可直接合入主干 |
| 版本控制 | 当前工作区无 `.git`、无分支、无 PR 流程 | 缺乏评审载体与追溯能力 |
| 文件体量 | `ingest.service.ts` **1329 行**、`questions.service.ts` 557 行 | god-service，单responsibility 违反，可读性/可测性差 |
| 质量分布 | `EmptyState.vue`、设计体系、`api.md` 为高质量样本，但同仓存在超长 service | **水平参差、标准未成文未强制** |

结论：质量问题的根因不是"不会写"，而是**缺成文标准 + 缺自动门禁 + 缺评审流程**。本文件同时补齐三者。

---

## 2. 角色与职责

| 角色 | 职责 |
|---|---|
| **作者（Author）** | 自测通过、填 PR 模板、按评审意见修改、确认 green CI |
| **评审人（Reviewer）** | 按第 3 章清单逐条核对，标注严重度，给出 `Approve / Request Changes` |
| **技术负责人（Tech Lead）** | 跨切面改动（权限模型、数据模型、AI 流水线、部署）的**必须审批人**；对 Major 问题的 waive 有最终决定权 |
| **CI（机器人）** | 自动执行 lint / typecheck / test / build，任一失败则阻塞合入 |

原则：**至少 1 名评审人 + 1 名技术负责人批准**方可合入（小团队可同一人兼任，但跨切面改动不得自审自合）。

---

## 3. 审查标准（检查清单）

每条标注严重度：`🔴 Blocker` / `🟠 Major` / 🟡 Minor / ⚪ Nit。

### 3.1 通用必查项（所有改动）

- 🔴 **安全**：无密钥/口令/令牌硬编码（AI Key 必须走 `settings` 表 AES 加密，绝不进 `.env`/compose/日志）；无 SQL 注入（Prisma 参数化，禁止字符串拼接 SQL）；无 XSS（前端渲染用户输入走 `{{ }}` 或 `v-text`，不 `v-html` 未净化内容）。
- 🔴 **权限**：所有写接口/敏感读接口有 `@RequirePermissions()` 或 `@Public()` 显式声明；无越权（按 `jobId`/`questionId` 查询时校验归属，不得仅凭 id 就返回他人数据）。
- 🔴 **数据完整性**：多步写库须置于事务（`prisma.$transaction`）；删除/更新须先查后改，缺资源抛 `NotFoundException` 而非空指针。
- 🔴 **错误处理**：后端统一抛 Nest 异常（`BadRequestException`/`NotFoundException` 等），不裸 `throw new Error`；错误经 `HttpExceptionFilter` 输出统一格式 `{code,message,path,timestamp}`（见 `api.md`）。
- 🟠 **状态机合法性**：枚举状态流转（如 `IngestJob`：`UPLOADED→SEGMENTING→RECOGNIZING→REVIEWING→DONE`）不得出现非法跳变；新建状态须同步更新文档与前端状态映射。
- 🟠 **空安全 / 类型**：禁止 `(x as any)` 绕过；`as unknown as T` 仅限 Prisma JSONB 字段边界；启用 `strict` 后不得用 `any` 掩盖问题（必要处用 `unknown` + 收窄）。
- 🟠 **并发与性能**：不在 `for` 循环内顺序 `await` 可并行的独立请求（批量写用 `Promise.all`）；大数组/分页查询禁止一次性 `findMany` 全量。
- 🟠 **魔法值**：超时（当前 180s）、内存阈值、容量上限须提取为命名常量并注释依据（参考 `ingest.service.ts` 的 `AbortSignal.timeout(180_000)` 注释风格）。
- 🟡 **命名/注释**：变量/函数见名知义；复杂分支与"为什么"用中文注释（与现有代码风格一致）；删除死代码与 `console.log`/`debugger`。
- ⚪ **格式**：由 Prettier + ESLint 自动处理，人工不纠结。

### 3.2 后端专项（NestJS 11 + Prisma 5 + BullMQ）

- 🟠 **DTO 校验**：入参必须建 DTO 并用 `class-validator`（`@IsString()/@IsInt()` 等）+ `class-transformer`；controller 用 `@Body() dto: XxxDto` 而非裸 `any`；分页/查询 DTO 必须有默认值与边界（如 `pageSize` 上限）。
- 🟠 **分层**：Controller 薄（仅参数解析 + 调用 service + 返回），业务逻辑在 Service；单 Service **超过 400 行需拆分或说明**（参考 `ingest.service.ts` 1329 行——按子域如 `detect`/`recognize`/`merge`/`approve` 拆子服务或策略类）。
- 🟠 **事务边界**：跨多张表/多记录的写操作（如 `editPaper` 同步 Question↔OcrItem、`reindexItems`）必须事务；失败须回滚且不残留半成品状态。
- 🟠 **Prisma 用法**：用生成的类型化 client；`where`/`data` 避免 `any`；批量用 `updateMany`/`createMany`；事务内避免再发网络 IO（AI 调用须在事务外）。
- 🟠 **异步与资源**：文件 IO 用 `fs/promises`；外部调用（OCR/VLM）必须超时与降级（参考 `AbortSignal.timeout` + `ALLOW_MOCK_VLM` 兜底）；禁止吞掉异常后静默返回错误结果。
- 🟡 **日志**：用 `Logger`（`new Logger(Svc.name)`）；**禁止把 AI 原始返回、用户试卷内容、密钥明文写入日志**；日志带 `jobId`/`itemId` 便于追溯。
- 🟡 **模块边界**：新增能力走 Nest 模块（`@Module`），不往已有 Service 硬塞；provider 用 `interface` 解耦（如 `VlmProvider` 接口 + mock/real 实现）。

### 3.3 前端专项（Vue3 + Element Plus + Pinia + Vite）

- 🔴 **设计令牌唯一真相源**：样式只允许 `var(--c-*)` / `var(--space-*)` / `var(--radius-*)`，**禁止写死颜色与像素间距**（见 `design-system.md` §1）；暗色通过 `html.dark` 覆盖变量，不写 `dark` 专属分支样式。
- 🔴 **响应式三规则**：表格 `<md` 转卡片（用 `ResponsiveTable`）；左右分栏 `<lg` 转堆叠（用 `SplitPane`）；侧栏 `<md` 收抽屉（`DefaultLayout`）。不得为"先跑起来"而跳过。
- 🟠 **基础组件复用**：空态用 `EmptyState`、加载用 `SkeletonList`、筛选用 `FilterChips`、表格用 `ResponsiveTable`——不得手搓重复实现。
- 🟠 **类型与 props**：`<script setup lang="ts">` + `defineProps<...>()` 或 `defineModel()`；`v-model` 双向子组件用 `defineModel` 或 `update:xxx` 事件；不 `mutate` prop。
- 🟠 **状态管理**：跨组件状态进 Pinia store（typed），不得用裸全局变量或 localStorage 直接当状态源；store action 做异步，组件只消费。
- 🟠 **错误与反馈**：请求统一走 axios 拦截器（错误提示 `ElMessage`，须 `import { ElMessage }`）；不在组件里散落 `try/catch` 吞错。
- 🟠 **数学公式**：题目文本含公式须用 `MathText` 组件（KaTeX），不得手拼 HTML。
- 🟡 **可访问性**：图标按钮有 `aria-label`；表单有 `label`；`aria-hidden` 用于装饰 SVG（参考 `EmptyState.vue`）。
- 🟡 **scoped 样式**：组件样式 `scoped`；全局样式只放 `tokens.scss` 与 `main.ts` 引入的基础层。
- ⚪ **删除 `console.log`**：提交前清除调试输出（CI 的 `no-console` 会 warn）。

### 3.4 AI / OCR 流水线专项

- 🔴 **密钥隔离**：`vlm`/`llm` 密钥只来自 `settings` 表（AES-256-GCM），运行时读取；**绝不出现在 compose、`.env`、前端打包、日志**。
- 🟠 **无密钥降级**：未配 VLM 密钥时 `detect`（本地 PaddleOCR）不受影响，`recognize` 须明确报错而非静默失败；`ALLOW_MOCK_VLM=1` 仅用于演示。
- 🟠 **超时与重试**：外部模型/服务调用必须超时（参考 180s）并有重试/降级；BullMQ 任务失败进死信或标记 `FAILED` 并写 `aiTaskLog`（仪表盘可查）。
- 🟠 **资源保护**：图片尺寸 `MAX_EDGE` 保护（超长边等比缩放，坐标归一化）；OCR 容器内存 ≥3G 防 OOM（`exit 137` 即 SIGKILL）。
- 🟡 **可观测**：`detect`/`recognize`/`solve` 均写 `AiTaskLog`；任务进度可前端轮询。

### 3.5 测试要求

当前测试数为 0，分两阶段补齐：

- **阶段一（强制，合入前必须有）**：下列路径**新增/修改必须带单测**
  - 后端：`auth`（login/refresh/logout 吊销）、`ingest` 状态机（upload→detect→recognize→approve→DONE）、`findDuplicate` 去重、题型归一化（`normalizeContent`/`stripScoreFromStem`/`resolveSubject`）、`reindexItems` 重编号。
  - 前端：关键 composable（`useTheme`/`useBreakpoint`）、`normalizeContent` 等价纯函数、组件快照（基础组件）。
- **阶段二（建议）**：Controller 集成测试（supertest）、关键用户流 E2E（Playwright，覆盖登录→录题→审阅→入库）。
- 工具：后端/前端统一 **Vitest**（`vue-tsc` 已在前端）；CI 跑 `npm test`，覆盖率门槛后续设定（建议核心模块 ≥60% 起步）。

### 3.6 命名与注释约定（与现有风格对齐）

- 注释语言：中文（与 `ingest.service.ts`、`design-system.md` 一致），写"为什么/约束"，不写废话。
- 文件/目录：kebab-case 或沿用 Nest 约定（xxx.service.ts / xxx.controller.ts / dto/*.dto.ts）。
- 提交信息：Conventional Commits（`feat:`/`fix:`/`refactor:`/`docs:`/`chore:` + 范围），见 §6 commitlint。

---

## 4. 严重度与处置规则

| 严重度 | 含义 | 处置 |
|---|---|---|
| 🔴 Blocker | 安全/数据/主流程/构建破坏性，或无关键路径测试 | **必须修，修前不得合入** |
| 🟠 Major | 逻辑错误、状态机非法、事务缺失、明显性能、违反强制规范 | 必须修，或技术负责人显式 waive 并建 TODO |
| 🟡 Minor | 可读性、命名、边界、非关键重复 | 建议修，可排期 |
| ⚪ Nit | 格式、拼写、风格偏好 | Prettier/ESLint 自动，不阻塞 |

评审结论用语：`Request Changes`（含 Blocker/Major 未决）或 `Approved`。

---

## 5. 审查流程（端到端）

```
作者自测 ─▶ 提 PR（填模板） ─▶ CI 门禁（lint+typecheck+test+build）
                                       │ green
                                       ▼
                          人工评审（≥1 评审人 + 技术负责人）
                                       │ Approved
                                       ▼
                              合入主干 ─▶ 预发冒烟 ─▶ 验收
```

1. **Step 0 — 基础设施（先决条件）**
   初始化 git 仓库，建立 `main` + feature 分支模型（小团队用 trunk-based：从 `main` 切 `feat/xxx`，PR 回 `main`）。无版本控制则本流程无法落地。

2. **Step 1 — 作者自测（提交前）**
   - 后端：`npm run lint && npx tsc --noEmit && npm test && npm run build`
   - 前端：`npx eslint "src/**/*.{ts,vue}" && npm run typecheck && npm test && npm run build`
   - 手动冒烟覆盖主流程（录题/审阅/入库或对应改动路径）。

3. **Step 2 — 提 PR + 填模板（见 §7）**
   必须关联需求/缺陷编号，写清改动范围、影响面、自测结论、视觉变更附截图/录屏。

4. **Step 3 — CI 门禁（自动，阻塞）**
   CI 跑 lint/typecheck/test/build，**任一红则 PR 不可合入**。此步替代"人工看格式"，把评审人力留给逻辑。

5. **Step 4 — 人工评审**
   评审人按第 3 章清单逐条核对，每条标注严重度与行号；`Request Changes` 时作者修改后重新触发 CI + 复评。跨切面改动须技术负责人批准。

6. **Step 5 — 合入与部署冒烟**
   合入后自动/手动部署预发，跑核心流程冒烟（登录、录题、审阅、入库、关键界面交互）；对照 `design-system.md` 走查视觉。

7. **Step 6 — 复盘沉淀**
   缺陷修复后输出修复记录（现象/根因/方案/影响版本），定期把重复性问题补进本标准的 §3 清单或 §6 工具规则。

---

## 6. 工具链落地（门禁如何自动化）

以下为**可直接落地**的配置，安装依赖后在仓库放置对应文件即可启用门禁。

### 6.1 根 `package.json` 增加统一脚本与 hooks

```jsonc
// package.json（节选，添加到现有 scripts）
{
  "scripts": {
    "lint": "npm run lint -w backend && npm run lint -w frontend",
    "test": "npm run test -w backend && npm run test -w frontend",
    "typecheck": "npm run typecheck -w frontend && npx tsc -p backend/tsconfig.json --noEmit",
    "prepare": "husky || true"
  },
  "lint-staged": {
    "backend/src/**/*.ts": ["eslint --fix"],
    "frontend/src/**/*.{ts,vue}": ["eslint --fix"],
    "**/*.{ts,vue,js,json,scss,md}": ["prettier --write"]
  },
  "devDependencies": {
    "husky": "^9",
    "lint-staged": "^15",
    "@commitlint/cli": "^19",
    "@commitlint/config-conventional": "^19"
  }
}
```

### 6.2 Prettier（两端共用）

`.prettierrc.json`
```json
{ "semi": true, "singleQuote": true, "trailingComma": "all", "printWidth": 100, "tabWidth": 2 }
```

### 6.3 后端 ESLint（flat config，ESLint 9）

`backend/eslint.config.mjs`
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'prisma/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: { parserOptions: { project: './tsconfig.json' } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'no-console': 'warn',
    },
  },
);
```
依赖：`eslint@^9 typescript-eslint@^8 eslint-config-prettier@^9`。并把 `backend` 的 `lint` 脚本改为 `"lint": "eslint ."`（覆盖全量，含测试）。

### 6.4 前端 ESLint（Vue3 + TS）

`frontend/eslint.config.mjs`
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  prettier,
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['vue'], project: './tsconfig.json' },
    },
  },
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/attribute-hyphenation': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'warn',
    },
  },
);
```
依赖：`eslint@^9 eslint-plugin-vue@^9 vue-eslint-parser@^9 typescript-eslint@^8 eslint-config-prettier@^9`。

### 6.5 提交规范 + 钩子

`.commitlintrc.json`
```json
{ "extends": ["@commitlint/config-conventional"] }
```
```sh
# 安装后启用
npx husky init
# .husky/pre-commit:  npx lint-staged
# .husky/commit-msg: npx --no -- commitlint --edit "$1"
```

### 6.6 CI（GitHub Actions 示例）

`.github/workflows/ci.yml`
```yaml
name: CI
on: [push, pull_request]
jobs:
  backend:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: backend } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: backend/package-lock.json }
      - run: npm ci
      - run: npx eslint .
      - run: npx tsc --noEmit
      - run: npm test --if-present
      - run: npm run build
  frontend:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: frontend } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: frontend/package-lock.json }
      - run: npm ci
      - run: npx eslint "src/**/*.{ts,vue}"
      - run: npm run typecheck
      - run: npm test --if-present
      - run: npm run build
```

---

## 7. PR / MR 模板

```markdown
## 关联
- 需求/缺陷编号：<ID>
- 类型：feat / fix / refactor / docs / chore

## 改动范围
- 后端接口：<列出受影响的 /api 路径与权限>
- 前端页面/组件：<列出>
- 数据库迁移：<是/否，迁移文件>
- 部署配置：<是/否>

## 自测结论
- [ ] 后端 lint / tsc / test / build 通过
- [ ] 前端 eslint / typecheck / test / build 通过
- [ ] 主流程手动冒烟通过（描述路径）

## 视觉变更
- [ ] 无 / 已对照 design-system.md 走查（附截图或录屏）

## 评审关注点
- 请重点看：<状态机/事务/权限/性能/AI 降级 等>

## 影响与回滚
- 影响面：<接口兼容性、数据兼容、前端缓存>
- 回滚预案：<配置回退 / 迁移回退 / 前端资源回退>
```

---

## 8. 落地路线图（建议节奏）

1. **第 1 周（止血）**：初始化 git + 分支；落地 §6.1–6.6 工具链；CI 先"报告不阻塞"，让团队适应。
2. **第 2 周（强制）**：CI 改为阻塞；`ingest.service.ts` / `questions.service.ts` 拆分为子服务（边拆边补单测，演示 §3.5 阶段一）。
3. **第 3–4 周（固化）**：所有新 PR 走完整流程；每周复盘把重复问题回填 §3；设定覆盖率门槛。
4. **持续**：季度体检——扫描超长文件、无测试模块、密钥泄露风险。

---

## 9. 与现有规范的衔接

- 前端强制项以 `docs/design-system.md` 为权威；本标准 §3.3 是其"审查化"表达。
- 接口/错误格式以 `docs/api.md` 为权威；§3.1 安全/错误项与之对齐。
- 历史修复经验见 `docs/bug-fix-plan-2026-08-17.md`，新增同类陷阱直接补进 §3 对应子类。

---

## 修订记录

| 日期 | 修订人 | 说明 |
|---|---|---|
| 2026-08-17 | 代码审查专家 | 初版：诊断现状、成文审查标准（通用/后端/前端/AI流水线/测试）、严重度模型、端到端流程、可落地工具链配置与 PR 模板、落地路线图 |
