-- AlterTable
ALTER TABLE "OcrItem" ADD COLUMN     "figures" JSONB;

-- CreateTable
CREATE TABLE "AiTaskLog" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "percent" INTEGER,
    "done" INTEGER,
    "total" INTEGER,
    "message" TEXT,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTaskLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiTaskLog_type_status_idx" ON "AiTaskLog"("type", "status");

-- CreateIndex
CREATE INDEX "AiTaskLog_createdAt_idx" ON "AiTaskLog"("createdAt");
