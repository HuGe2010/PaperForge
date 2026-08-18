-- 去重合并：允许多个录题项(OcrItem)指向同一道题目(Question)，去掉 assignedQuestionId 唯一约束
DROP INDEX "OcrItem_assignedQuestionId_key";
