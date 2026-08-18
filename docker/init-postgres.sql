-- 启用 pg_trgm：试题题干 / 标签的模糊相似度检索（查重、高级筛选）
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 可选：中文全文检索（部署时可按需启用 zhparser，此处仅预留）
-- CREATE EXTENSION IF NOT EXISTS zhparser;
