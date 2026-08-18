-- 审阅台合并跨页截断题：支持回退
-- 1) 被合并项不再删除，标记 mergedIntoId 指向主项，回退时拆开
-- 2) 主项记录合并前的 sourceImagePath / bbox，回退时恢复
ALTER TABLE "OcrItem" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "OcrItem" ADD COLUMN "mergedFromImagePath" TEXT;
ALTER TABLE "OcrItem" ADD COLUMN "mergedFromBbox" JSONB;

CREATE INDEX "OcrItem_mergedIntoId_idx" ON "OcrItem"("mergedIntoId");
