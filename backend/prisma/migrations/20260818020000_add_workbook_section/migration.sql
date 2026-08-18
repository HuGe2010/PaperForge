-- 审阅台选作业本时支持选到具体章节：IngestJob 增加 workbookSectionId
ALTER TABLE "IngestJob" ADD COLUMN "workbookSectionId" TEXT;

CREATE INDEX "IngestJob_workbookSectionId_idx" ON "IngestJob"("workbookSectionId");
