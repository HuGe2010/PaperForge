# 15 条 Bug / 需求 — 根因分析与修复方案（2026-08-17）

> **状态：两轮迭代完成，全部编码 + 编译全绿 + Docker 冒烟通过（reviewItem 分组字段、paper-edit 接口已验证）。**

> 基于当前代码逐条定位根因。前端核心在 `frontend/src/views/teacher/IngestView.vue`（框选编辑器 + 审阅台 + 合并），后端核心在 `backend/src/modules/ingest/ingest.service.ts`、`vlm/` 各 provider、`ocr/app.py`。

---

## 1. 删除框后题号不对应（框题编辑器 vs 审阅台）

**现象**：框题编辑器里删掉一个框后，剩余框序号自动重排（1,2,3,4）——正确；但审阅台点开，题号与框题时不一致。

**根因**：
- 框选编辑器的序号是**前端临时生成**的：`syncLocalBoxes()` 按排序位置 `idx + 1` 动态编号，仅用于显示；
- 审阅台显示的是**后端持久化**的 `item.number ?? item.index`；
- 后端删除框 `reviewItem(DISCARDED)` 是**物理删除，但没有对剩余项重新编号** → 后端 index 变成跳号（1,2,4,5），前端重排显示 1,2,3,4，两者对不上。新增框 `addBox` 用 `max(index)+1` 同样会跳号。

**方案**：后端在「删除框」「新增框」后对该 job 剩余项**按页序 + 纵向坐标重新编号**（reindex），前端框选编辑器与审阅台统一读 `item.index`，不再各自生成序号。

---

## 2. 合并后题目数不刷新（一张图一个 id，合并后舍弃一个 id）

**现象**：两道跨页截断题合并成一道后，「录入任务」页面的题目数不变。

**根因**：列表页 `listJobs()` 的 `_count.items` 统计了**全部** ocrItem，包括被合并项（`mergedIntoId` 非空、getJob 里已被隐藏的那条）。合并后 keep + merged 两条都还在库里，所以题数没变。

**方案**：`listJobs()` 与 `listFiles()` 的 count 都改为**只统计 `mergedIntoId: null` 的有效项**（Prisma `_count` 支持关系过滤）。合并后题目数立即减 1，符合「一张图一个 id、合并后舍弃一个 id」。

---

## 3. 合并后重开框题编辑器：应显示两个框（只读）+「已合并」提示

**现象**：合并后的图已保存用于 AI 识别（这块已做到），但重新点「框选题目」时，对应框不能改，且显示不对。

**根因**：
- `getJob()` 用 `where: { mergedIntoId: null }` 把被合并项**隐藏**了；
- 主项合并时 `bbox` 被清成 `DbNull`、`sourceImagePath` 指向拼接图 → 框选编辑器渲染出一个「默认全图框」（bbox 为空走兜底 [0.05,0.05,0.95,0.95]），既不能体现原始两个框，也失去了「已合并」语义；
- 另外 `detect()` 重新框选时会删除 `mergedIntoId: null` 的未定稿项（含主项），却保留被合并项 → 产生**孤儿项**（mergedIntoId 指向已删除的主项）。

**方案**：
- `getJob()` 返回**全部 items**（含被合并项），前端类型补全 `mergedIntoId` 等字段；
- 框选编辑器区分三类框：普通框（可拖动/缩放/删除）、**已合并题的两个原始框**（只读，显示「已合并」角标）、被合并项（只读）；
- 合并主项用 `mergedFromBbox`（合并前自身框）+ 被合并项的 `bbox` 拼出两个原始框展示；
- `detect()` 重新框选前，先把该 job 所有**未定稿合并项回退拆开**（清 `mergedIntoId`、恢复 `bbox`），再统一清理重框，杜绝孤儿。

---

## 4. 已入库的框不可删除，保留并提示「已入库」，改框刷新入库状态

**根因**：`reviewItem(DISCARDED)` 直接物理删除，**不检查 `status=APPROVED`**；前端 `deleteBox()` 也无拦截；改 bbox 不改变状态。

**方案**：
- 后端：`DISCARDED` 且 `APPROVED` → 抛错拒绝删除；
- 后端：`APPROVED` 项收到 **bbox 修改**时，自动重置 `status=DETECTED`、`assignedQuestionId=null`（题目回到待识别/待入库）；
- 前端框选编辑器：`APPROVED` 框显示「已入库」角标，删除按钮禁用；拖动/缩放该框时弹出提示「修改此框将刷新入库状态，需重新识别入库」。

---

## 5. 审阅台内已合并的题：两张图、两个框

**根因**：审阅台合并题目前显示**拼接图**（`mergedImageMap`）或整页图 +「已合并」角标，没有展示合并前两页原图 + 各自框。

**方案**：审阅台对合并题（`mergedFromImagePath` 非空）渲染**两张原图**（主项合并前所在页 + 被合并项所在页），各自按原始 bbox 高亮，标注「上/下 · 第 N 页」；保留「已合并」标记与「撤销合并」按钮。**AI 识别仍用后端保存的拼接图**（`sourceImagePath`），两图两框仅用于人工核对。
（需后端把被合并项带出，见第 3 条。）

---

## 6. 题库「按试卷」：点击试卷名文字进入，且是可关闭可返回的窗口

**根因**：`QuestionListView.vue` 按试卷 tab 是 `el-table`，试卷名**不可点击**；「查看」按钮跳路由（带 query 刷新列表），不是窗口，且无返回/关闭语义。

**方案**：
- 试卷名渲染为可点击文字；
- 点击后打开 **Dialog / Drawer 窗口**（不跳路由），内嵌该卷题目列表（复用 `questionsApi.list({ sourcePaper })`，带分页/筛选），点题目可进详情；
- 窗口可关闭、可返回，原列表状态不丢失。作业本 tab 同样处理。

---

## 7. 题库里简答题不显示小题

**根因**：`QuestionContentView.vue` 对 `SHORT_ANSWER / ESSAY` 只渲染 `content.rubric`，**不渲染 `subQuestions`**；而审阅台对多小问的简答题存的是 `content.subQuestions`。详情页编辑态也只有 READING/MATERIAL 有小编辑器，简答题编辑时小题没有编辑入口。

**方案**：
- `QuestionContentView`：SHORT_ANSWER/ESSAY 存在 `subQuestions` 时按小题列表渲染（参考 MATERIAL 分支）；
- 题库详情页编辑态：简答/论述补「小题」编辑器（`SubQuestionsEditor`）。

---

## 8. 分值：识别时题干不带分值；分值放左侧图片下方（可改，题库也可）；AI 解题喂分值

**根因**：
- 识别 prompt 未约束分值 → 模型可能把「（10分）」拼进题干；
- `content` 只有 MATERIAL 小题存了 `score`，大题分值无处可填；
- `llm.service.buildPrompt()` 没有把分值传给模型。

**方案**：
- 识别 prompt（`real-vlm.provider.ts`）：明确「题干中**不要**包含分值/得分信息；如有分值单独填到 score 字段（大题分值）或 subQuestions[].score」；识别结果归一化时把题干中尾部的 `（X分）` 剥离；
- 数据：`content.score`（大题分值，可选）；
- 前端审阅台：左侧图片**下方**加「分值」输入框（随 `persistItem` 提交 `content.score`）；
- 题库详情页：左侧图片下方同样加分值显示/编辑（查看态可读，编辑态可改）；
- `llm.service.solve()`：把 `content.score` / `subQuestions[].score` 拼进 prompt：「本题 X 分，请按分值给出得分点」。

---

## 9. 日志功能 + AI「工作进度」统一显示在仪表盘（像日志一样）

**根因**：`DashboardView.vue` 目前是空壳；`detect` 有内存进度（`detectProgress`），`recognize` / `solve` 无进度上报、无日志。

**方案**：
- 后端新增轻量「AI 任务日志」：内存环形队列（`type: detect|recognize|solve`、`title`（文件名/题目）、`status`、`percent`、`done/total`、`message`、时间戳），detect 复用现有进度回调、recognize 增加逐题进度、solve 记录起止；
- 新增接口 `GET /system/tasks` 返回进行中 + 最近 N 条；
- 前端仪表盘新增「AI 工作进度」卡片：轮询渲染进度条列表（进行中的显示进度条，完成的折叠为日志行，像日志一样滚动）。

---

## 10. AI 框题进度条太大 → 改小

**根因**：`el-progress :stroke-width="10"`。

**方案**：stroke-width 改 4~5，字号缩小，或改为紧凑「小条 + 文本」。

---

## 11. 隐藏框题调试信息

**根因**：框选编辑器底部 `el-collapse` 调试面板（提示词 / AI 原始回复）。

**方案**：直接移除该面板及其前端调用（后端 `detect-prompt` 接口保留不影响）。

---

## 12. 框题编辑器：试卷大小可调（拖动条），框不漂移

**根因**：图片 `max-width:100%; max-height:68vh`，无缩放控件。

**方案**：工具栏加缩放滑块（如 40%~150%）；图片容器宽度由滑块控制、图片 `width:100%`；框用**百分比定位**天然跟随缩放**不漂移**（拖拽坐标 `norm()` 实时取 `getBoundingClientRect`，任意缩放下都正确）。

---

## 13. 云端 OCR 优化：只框大题（大题内小题不框），并识别题目

**根因**：`paddleocr-vl.provider.ts` 把 PaddleOCR-VL 返回的每个 `text/paragraph` 块**都当作一个框**返回 → 大题内小题被单独框出。

**方案**：
- 云端解析后处理：以 `paragraph_title`（大题标题）为分组起点，把其后同区域 `text` 块**合并成一个大题框**（阅读理解/材料/解答题等大题只出一个框）；选择题、填空题等按题号/标题粒度分组（粒度见确认项）；
- 本地 OCR `ocr/app.py` 同步优化：识别到大题标题（阅读/材料/解答等）后，其下 `(1)(2)(3)` 及 `1.` 编号行**不再开新框**，合并进大题框；
- 「识别题目」：框选完成后走现有「识别题目」流程（VLM 逐框识别，大题内小题一并识别）。

---

## 14. AI 识别：第一次让 AI 自己判断题型，之后按人工选择

**根因**：`recognize()` 对 `type` 为空的题**直接跳过**（skipped）；且识别 prompt 的 `typeHint` 强制「type 保持 X 不变」。

**方案**：
- `type` 为空（首次识别）→ 不跳过，VLM 调用**不带 typeHint**，由模型返回 `type`，识别后回填 `item.type`；
- `type` 非空（人工已选择）→ 按人工 type 约束提取内容（现有行为）；
- `recognizeItem()` 单题重识别同样支持；去掉 skipped 提示逻辑。

---

## 15. 所有题型支持图片（题目带图）：OCR 识别图片区域、单独框选、做好提示

**现状**：系统完全没有题图支持。

**方案**（范围见确认项）：
- detect（本地 + 云端）识别 `figure/image` 块 → 作为**图片框**单独返回并标记；
- 数据：`OcrItem.figures Json?`（`[{bbox, cropPath}]`）→ 入库写入 `content.images`；
- 框选编辑器：图片框显示「图片」标记（可单独删除/调整），并提示「该区域为图片」；
- 审阅台 + 题库：题目卡片/详情展示图片列表（缩略图可点开大图）；
- 识别 prompt：让 VLM 输出题目内图片的说明/位置，与框选结果对齐。

---

## 用户确认结果（2026-08-17 提问）
1. **云端 OCR 粒度**：选择题**每题一框**（保持现状）；只有大��（阅读理解/材料/解答/论述）整大题一框，小题不单独框。
2. **题图功能**：与框题干一致——OCR 识别图片区域 → 单独框选（显示「图片」标记 + 所属题号）→ 识别后人工可改（移动/缩放/删除）。
3. **仪表盘日志**：**入库持久化**（数据库表 AiTaskLog，重启保留、可翻页）。
4. **题库按试卷窗口**：点试卷名进入**窗口（Dialog）**，展示该卷题目，**按大题（一二三四）分组**展示；题目详情里点「来源试卷」也进入同一个窗口。
5. **审阅台合并题**：两图两框供人工核对，拼接图仍保存用于 AI 识别（默认理解，未被推翻）。

## 实施记录（2026-08-17）
### 数据层
- `OcrItem.figures Json?`（题内图片区域）；新增 `AiTaskLog` 表（AI 任务日志）。
- 迁移 `backend/prisma/migrations/20260817000000_ai_task_log_and_figures/`（migrate deploy 自动执行）。

### 后端
- `ingest.service.ts`：
  - `reindexItems()`：删除/新增框后按页序+纵坐标重编号 → 修 Bug1（框选/审阅台题号一致）；
  - `reviewItem()`：已入库框不可删（DISCARDED+APPROVED 抛错）；改已入库题的框自动刷新入库状态（status→DETECTED、assignedQuestionId=null）；支持 figures；
  - `getJob()` 返回全部 items（含被合并项）→ 支撑 Bug3/5 两框两图；`listJobs/listFiles` 的 _count 排除被合并项 → 修 Bug2（合并后题数减 1）；
  - `detect()` 重框前清空全部未定稿（含合并项），杜绝孤儿；写入 AiTaskLog 进度；
  - `recognize()/recognizeItem()`：题型为空时首次让 VLM 自判并回填（Bug14）；题干剥离「（X分）」到 content.score（Bug8）；题图 figures 识别后裁切保存（Bug15）；
  - `approveItem()` 把 figures 写入 content.images（Bug15）；
- `real-vlm.provider.ts`：detect 提示词改为「大题整题一框、选择题每题一框、题图 figures 单独标记」（Bug13/15）；recognize 提示词加「题干不含分值」+ 首次判题型（Bug8/14）；
- `paddleocr-vl.provider.ts`：云端块分组（大题合并、选择题按题号、图片块单独标记）（Bug13/15）；
- `ocr/app.py`：本地 OCR 大题合并 + 题图启发式检测（Bug13/15）；
- `llm.service.ts`：AI 解题 prompt 携带 content.score / 小题分值 → 按分值给得分点（Bug8）；
- 新增 `ai-tasks` 模块：GET /ai-tasks（进行中置顶+最近 N 条）（Bug9）；`questions` 新增 GET /questions/figure/:cropId（题图）（Bug15）。

### 前端
- `IngestView.vue`：框选编辑器（合并两框只读+「已合并」角标、已入库角标+禁删+改框刷新提示、缩放滑块不漂移、隐藏调试信息、进度条改小、题图框可拖）（Bug3/4/10/11/12/15）；审阅台（合并题两图两框、分值输入、题图展示、被合并项不单独出现）（Bug5/8/15）；
- `QuestionContentView.vue`：简答/论述小题渲染（Bug7）；
- 新增 `PaperWindow.vue` 全局窗口 + `usePaperWindow` composable + `DefaultLayout` 挂载：题库按试卷/作业本点文字进窗口（按大题分组），题目详情点来源试卷进同一窗口（Bug6）；
- `QuestionDetailView.vue`：简答小题编辑、图片下方分值、题图展示、来源试卷进窗口（Bug6/7/8/15）；
- `DashboardView.vue`：AI 工作进度卡片（轮询 /ai-tasks，进度条+日志）（Bug9）；
- `api/`：ingest.ts figures、questions.ts figureUrl、aiTasks.ts；`types/models.ts` 补字段。

### 待办
- ~~Docker compose 端到端冒烟（迁移/seed/前后端启动）~~ → 已完成（2026-08-17）：
  - 五容器 healthy；`/api/health` ok；登录正常；
  - 新迁移自动执行（AiTaskLog 表）、`/api/ai-tasks` 返回正常、`/api/questions/figure/:cropId` 业务 404 正常；
  - 上传→detect 全链路：8 框 + AiTaskLog「DONE 框选完成，共 8 题」；
  - 删除框 reindex 验证：8 框删 1 后 index=[1..7] 连续；
  - 合并验证：getJob 返回 7 条（含被合并项 mergedIntoId）、主项 mergedFromImagePath 置位、列表 count=6；
  - OCR 容器重建成功：apt 源切阿里云镜像（原 deb.debian.org 网络失败）→ `docker/Dockerfile.ocr` 已同步修复。
- 本地 OCR「大题合并/题图检测」的真实中文试卷效果需用真实试卷页验证（冒烟测试图为英文，无中文大题标题）。

## 第二轮迭代（2026-08-17 下午，用户反馈后）
### 框选编辑器
- **拖动修复**：`onBoxDown/onResizeDown` 改为函数内判断只读（不再用模板三元表达式）+ Pointer Capture + `touch-action:none`；已入库框用绿色虚线样式区分（可拖，改框刷新入库状态）。
- 删除「调整缩放不会改变框的位置（坐标为归一化）」提示。
- `ingest__pipeline` 顶部大步骤条 → 精简为紧凑「圆点序号 + 文字」流程标签（`.pipe`）。
### 审阅台右侧「大题与题号」面板（新）
- 右侧 300px 面板：按大题分组显示题号列表；
- **拖题目到某组** = 改 groupIndex/groupTitle（即存，`refreshActive` 同步刷新左侧题卡）；
- **拖题目到另一题上** = 合并（复用 buildMergedImage 自动拼接两页图 + 确认弹窗）；
- **大题标题点击可编辑**（整组同步）；合并题面板上带「撤销合并」。
- 审阅台布局改左右分栏：`review__body`（main + rail）。
### 按钮文案 / 题型提示
- 按 `jobRecognized`（是否有 PENDING_REVIEW 或 attempts）切换：全部识别/重新识别全部、识别/重新识别。
- `recognize` 返回 `aiAssignedTypes`，识别后 ElMessage 提示「AI 已判断题型：第 X 题 → 单选题…」；单题识别任务也写 AiTaskLog。
### 简答题小题题型
- 简答/论述小题编辑器 `show-type`（审阅台/题库编辑/新建题目三处），小题题型第一次 AI 自动识别（prompt 与 normalizeContent 支持 type），人工随时可改。
### AI 解答答案完整性
- `solveQuestion` 补 MATERIAL/SHORT_ANSWER/ESSAY 答案回填（subAnswers 逐小题 / answer 单题）；LLM system prompt 要求所有题型给答案；无分值也正常解题（分值仅作参考）。
### PaperWindow 编辑试卷（新）
- 试卷窗口加「编辑试卷」：改名（后端 `editPaper` 同步该卷所有题 sourcePapers/sourcePaperName + 文件记录名）、题目排序（上移/下移）、大题修改（标题/归属 select/增删组）；保存后全卷题号自动重排。
### AI 工作进度跳转
- `AiTaskLog` solve 任务 jobId 改为存 question.id；仪表盘条目可点击：solve → 题库详情，detect/recognize → `/teacher/ingest?jobId=`（IngestView 挂载时定位并打开审阅台）。
### OCR 题图
- 本地 `ocr/app.py` 增加 `detect_tables`（横竖线网格检测），表格与立体几何图一并算题图，`merge_boxes` 去重合并后挂到所属题框 figures。
