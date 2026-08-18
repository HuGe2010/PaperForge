-- 页面级图片框：与题目框解耦，框选阶段可手绘独立的图片区域
ALTER TABLE "IngestPage" ADD COLUMN "figures" JSONB;
