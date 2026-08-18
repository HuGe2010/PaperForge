-- 作业本归属重构：题目归属由「名称路径快照 sourcePath」改为「章节外键 workbookSectionId」。
--
-- 背景（修复的线上缺陷）：
--   原设计用 sourcePath（[作业本名, 章节名, ...]）判定题目归属，但重命名作业本 / 重命名章节 /
--   移动章节时并不回写题目路径，导致题目在任何章节与「作业本根」里都匹配不到 —— 题目凭空消失。
-- 修复后：
--   workbookId + workbookSectionId 为唯一真相；sourcePath 降级为派生的展示字段，由后端统一重算。
--
-- 本迁移为纯增量（新增可空列 + 索引 + 外键），不删除任何列与数据，可安全回退（DROP COLUMN 即可）。

-- 1) 新增归属外键列
ALTER TABLE "Question" ADD COLUMN "workbookSectionId" TEXT;

CREATE INDEX "Question_workbookSectionId_idx" ON "Question"("workbookSectionId");

ALTER TABLE "Question"
  ADD CONSTRAINT "Question_workbookSectionId_fkey"
  FOREIGN KEY ("workbookSectionId") REFERENCES "WorkbookSection"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) 回填：按现有 sourcePath 反解章节。
--    递归 CTE 为每个章节算出根→叶的名称路径，再与题目 sourcePath 去掉首段（作业本名）后比对。
--    注：因重命名而已失配的历史脏路径无法反解，将在第 4 步收敛到「作业本根」（从不可见恢复为可见）。
WITH RECURSIVE sec AS (
  SELECT id, "workbookId", "parentId", ARRAY[name] AS path
  FROM "WorkbookSection"
  WHERE "parentId" IS NULL
  UNION ALL
  SELECT c.id, c."workbookId", c."parentId", s.path || c.name
  FROM "WorkbookSection" c
  JOIN sec s ON c."parentId" = s.id
)
UPDATE "Question" q
SET "workbookSectionId" = sec.id
FROM sec
WHERE q."workbookId" = sec."workbookId"
  AND COALESCE(array_length(q."sourcePath", 1), 0) > 1
  AND q."sourcePath"[2:array_length(q."sourcePath", 1)] = sec.path;

-- 3) 规范化 sourcePath：已解析到章节的题目，按 [作业本名, ...章节全路径] 重写，与外键保持一致。
WITH RECURSIVE sec AS (
  SELECT id, "workbookId", "parentId", ARRAY[name] AS path
  FROM "WorkbookSection"
  WHERE "parentId" IS NULL
  UNION ALL
  SELECT c.id, c."workbookId", c."parentId", s.path || c.name
  FROM "WorkbookSection" c
  JOIN sec s ON c."parentId" = s.id
)
UPDATE "Question" q
SET "sourcePath" = ARRAY[w.name] || sec.path
FROM sec, "Workbook" w
WHERE q."workbookSectionId" = sec.id
  AND w.id = q."workbookId";

-- 4) 属于作业本但未落到任何章节（含历史失配的孤儿路径）：收敛到作业本根，路径仅存作业本名。
UPDATE "Question" q
SET "sourcePath" = ARRAY[w.name]
FROM "Workbook" w
WHERE q."workbookId" = w.id
  AND q."workbookSectionId" IS NULL;

-- 5) 已不属于任何作业本却残留路径的题目（如作业本被删除后 workbookId 置空）：清空脏路径。
UPDATE "Question"
SET "sourcePath" = '{}'
WHERE "workbookId" IS NULL
  AND COALESCE(array_length("sourcePath", 1), 0) > 0;
