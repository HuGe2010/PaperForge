-- 文件类型（试卷/作业本）+ 作业本层级 + 题号/大题号 数据模型

-- IngestJob：文件类型 + 学科
ALTER TABLE "IngestJob" ADD COLUMN "sourceType" TEXT;
ALTER TABLE "IngestJob" ADD COLUMN "subjectId" TEXT;
ALTER TABLE "IngestJob" ADD CONSTRAINT "IngestJob_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 作业本层级节点（任意多级树形）
CREATE TABLE "WorkbookSection" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkbookSection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkbookSection_jobId_idx" ON "WorkbookSection"("jobId");
CREATE INDEX "WorkbookSection_parentId_idx" ON "WorkbookSection"("parentId");
ALTER TABLE "WorkbookSection" ADD CONSTRAINT "WorkbookSection_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "IngestJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkbookSection" ADD CONSTRAINT "WorkbookSection_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WorkbookSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- OcrItem：题号 + 大题号 + 大题标题 + 作业本节点
ALTER TABLE "OcrItem" ADD COLUMN "number" INTEGER;
ALTER TABLE "OcrItem" ADD COLUMN "groupIndex" INTEGER;
ALTER TABLE "OcrItem" ADD COLUMN "groupTitle" TEXT;
ALTER TABLE "OcrItem" ADD COLUMN "sectionId" TEXT;
ALTER TABLE "OcrItem" ADD CONSTRAINT "OcrItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "WorkbookSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "OcrItem_sectionId_idx" ON "OcrItem"("sectionId");

-- Question：题号 + 大题号 + 文件关联 + 作业本层级路径
ALTER TABLE "Question" ADD COLUMN "number" INTEGER;
ALTER TABLE "Question" ADD COLUMN "groupIndex" INTEGER;
ALTER TABLE "Question" ADD COLUMN "groupTitle" TEXT;
ALTER TABLE "Question" ADD COLUMN "sourceFileId" TEXT;
ALTER TABLE "Question" ADD COLUMN "sourcePath" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Question" ADD CONSTRAINT "Question_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "IngestJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Question_sourceFileId_idx" ON "Question"("sourceFileId");
