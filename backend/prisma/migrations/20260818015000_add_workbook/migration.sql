-- 作业本独立实体：新增 Workbook 表；WorkbookSection 由挂在 IngestJob 改为挂在 Workbook；
-- Question / IngestJob 增加 workbookId；IngestJob.sections 关系随 jobId 列移除而消失。
-- 数据迁移：为每个 WORKBOOK 录入任务（或含章节的任务）创建一个 Workbook，并把其章节归并到该 Workbook。

-- 1. 作业本表
CREATE TABLE "Workbook" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "subjectId" TEXT,
  "ownerId" TEXT,
  "description" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Workbook_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Workbook_subjectId_idx" ON "Workbook"("subjectId");
CREATE INDEX "Workbook_ownerId_idx" ON "Workbook"("ownerId");
ALTER TABLE "Workbook" ADD CONSTRAINT "Workbook_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Workbook" ADD CONSTRAINT "Workbook_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. WorkbookSection 增加 workbookId 列
ALTER TABLE "WorkbookSection" ADD COLUMN "workbookId" TEXT;

-- 3. 数据迁移：为每个 WORKBOOK 任务（或曾建过章节的任务）新建一个 Workbook（id = 'wb_' + 任务id，确保可反查）
INSERT INTO "Workbook" ("id", "name", "subjectId", "createdById", "createdAt", "updatedAt")
SELECT 'wb_' || "id", "fileName", "subjectId", "createdById", "createdAt", NOW()
FROM "IngestJob" j
WHERE ("sourceType" = 'WORKBOOK' OR EXISTS (SELECT 1 FROM "WorkbookSection" s WHERE s."jobId" = j."id"))
  AND NOT EXISTS (SELECT 1 FROM "Workbook" w WHERE w."id" = 'wb_' || j."id");

-- 将章节归并到对应 Workbook（仅当该任务已建 Workbook）
UPDATE "WorkbookSection" s SET "workbookId" = 'wb_' || s."jobId"
WHERE EXISTS (SELECT 1 FROM "Workbook" w WHERE w."id" = 'wb_' || s."jobId");

-- 清理无主章节（任务既不是 WORKBOOK 又无对应 Workbook 的脏数据）
DELETE FROM "WorkbookSection" WHERE "workbookId" IS NULL;

-- 4. 移除 WorkbookSection.jobId 旧外键与列
ALTER TABLE "WorkbookSection" DROP CONSTRAINT IF EXISTS "WorkbookSection_jobId_fkey";
ALTER TABLE "WorkbookSection" DROP COLUMN "jobId";

-- 5. WorkbookSection.workbookId 外键
ALTER TABLE "WorkbookSection" ADD CONSTRAINT "WorkbookSection_workbookId_fkey" FOREIGN KEY ("workbookId") REFERENCES "Workbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Question.workbookId
ALTER TABLE "Question" ADD COLUMN "workbookId" TEXT;
ALTER TABLE "Question" ADD CONSTRAINT "Question_workbookId_fkey" FOREIGN KEY ("workbookId") REFERENCES "Workbook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Question_workbookId_idx" ON "Question"("workbookId");

-- 7. IngestJob.workbookId
ALTER TABLE "IngestJob" ADD COLUMN "workbookId" TEXT;
ALTER TABLE "IngestJob" ADD CONSTRAINT "IngestJob_workbookId_fkey" FOREIGN KEY ("workbookId") REFERENCES "Workbook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "IngestJob_workbookId_idx" ON "IngestJob"("workbookId");
