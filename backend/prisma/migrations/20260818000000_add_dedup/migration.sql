-- 题目查重（人工）：忽略记录 + 合并操作日志
-- CreateTable
CREATE TABLE "DedupIgnore" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "questionIds" TEXT[],
    "pairs" TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DedupIgnore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DedupMerge" (
    "id" TEXT NOT NULL,
    "keptId" TEXT NOT NULL,
    "absorbedIds" TEXT[],
    "backup" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DedupMerge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DedupIgnore_createdAt_idx" ON "DedupIgnore"("createdAt");

-- CreateIndex
CREATE INDEX "DedupMerge_keptId_idx" ON "DedupMerge"("keptId");

-- CreateIndex
CREATE INDEX "DedupMerge_createdAt_idx" ON "DedupMerge"("createdAt");
