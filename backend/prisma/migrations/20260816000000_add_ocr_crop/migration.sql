-- 单题裁切：为 OcrItem 增加 cropId（裁切随机 id，入库后作为题目唯一 id）与 cropImagePath（按 bbox 裁出的单题图路径）
-- AlterTable
ALTER TABLE "OcrItem" ADD COLUMN "cropId" TEXT;

ALTER TABLE "OcrItem" ADD COLUMN "cropImagePath" TEXT;
