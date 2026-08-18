-- 题目语义向量（查重第二层）：题干 embedding，模型变更后批量重算
-- CreateTable
CREATE TABLE "QuestionEmbedding" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dims" INTEGER NOT NULL,
    "vector" DOUBLE PRECISION[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuestionEmbedding_questionId_key" ON "QuestionEmbedding"("questionId");

-- CreateIndex
CREATE INDEX "QuestionEmbedding_model_idx" ON "QuestionEmbedding"("model");
