-- 7 步 OCR 录题流水线改造

-- 新增 OcrItem 状态：DETECTED（已自动框选，待人工核对 / 内容识别）
ALTER TYPE "OcrItemStatus" ADD VALUE 'DETECTED';

-- IngestPage：自动框选时由 VLM 识别的试卷标题
ALTER TABLE "IngestPage" ADD COLUMN "paperName" TEXT;

-- OcrItem：逐题所属试卷（默认继承页面识别值，可覆盖）
ALTER TABLE "OcrItem" ADD COLUMN "paperName" TEXT;

-- Question：来源试卷名 / 后台 AI 解答 / 解答所用模型
ALTER TABLE "Question" ADD COLUMN "sourcePaperName" TEXT;
ALTER TABLE "Question" ADD COLUMN "llmModel" TEXT;
ALTER TABLE "Question" ADD COLUMN "solution" TEXT;
