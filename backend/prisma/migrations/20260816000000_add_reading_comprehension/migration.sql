-- 新增「阅读理解」题型（英语/语文大题：含阅读材料 + 多个小题，小题可为选择或简答）
-- 注：PostgreSQL 16 允许在事务内 ALTER TYPE ... ADD VALUE（已在目标环境实测），
-- 因此 migrate deploy（默认事务包裹）可正常执行。
ALTER TYPE "QuestionType" ADD VALUE 'READING_COMPREHENSION';
