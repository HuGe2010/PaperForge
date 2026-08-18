-- 题目支持「多来源试卷」（同一题可属于多张卷，去重合并时追加）
ALTER TABLE "Question" ADD COLUMN "sourcePapers" TEXT[] NOT NULL DEFAULT '{}';

-- 旧数据回填：sourcePaperName 非空时写入数组首项（保留兼容，不删旧字段）
UPDATE "Question" SET "sourcePapers" = ARRAY["sourcePaperName"] WHERE "sourcePaperName" IS NOT NULL AND "sourcePaperName" <> '';
