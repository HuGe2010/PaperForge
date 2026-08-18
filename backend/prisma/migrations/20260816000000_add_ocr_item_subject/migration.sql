-- 录入题目项支持 AI 识别学科（subjectId），与 Question 表对齐
-- AlterTable
ALTER TABLE "OcrItem" ADD COLUMN "subjectId" TEXT;

ALTER TABLE "OcrItem" ADD CONSTRAINT "OcrItem_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "OcrItem_subjectId_idx" ON "OcrItem"("subjectId");
