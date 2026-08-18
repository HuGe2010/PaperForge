# Bug 修复记录：PDF 上传 413 + PDF 逐页转图处理

**日期**：2026-08-16
**影响范围**：`docker/nginx.conf`、`ocr/app.py`、`ocr/requirements.txt`、`backend/src/modules/ingest/ingest.service.ts`、`backend/src/modules/ingest/ingest.controller.ts`、`frontend/src/api/client.ts`、`frontend/src/api/ingest.ts`

## 问题现象

上传 PDF 试卷报错：`Request failed with status code 413`（Payload Too Large）。

## 根因

1. **nginx 未设置 `client_max_body_size`**：默认 1MB，PDF/高清扫描图一传即被 nginx 直接拦截返回 413（响应体不是 JSON，前端拿不到 message，只显示原生 413 文案）。
2. **PDF 未做转图处理**：原实现把 PDF 原样存为单页直接丢给云端 VLM，无法裁切单题，识别质量差；且依赖云端视觉模型对 PDF 的支持。

## 修复方案

### 1. nginx 上传上限（`docker/nginx.conf`）
- server 级新增 `client_max_body_size 50m;`，与后端 multer 限制对齐。

### 2. PDF 逐页转图（OCR 容器，`ocr/app.py` + `ocr/requirements.txt`）
- 新增依赖 `PyMuPDF==1.24.10`（纯 wheel，无需 poppler 系统库）。
- 新增 `POST /pdf-to-images` 端点：multipart 收 PDF（字段 `file`，可选 `dpi` 默认 150，范围 72~300），逐页转 PNG，返回
  `{"count": N, "pages": [{"page":1,"width":W,"height":H,"image":"<base64 png>"}]}`。

### 3. 后端上传转图（`ingest.service.ts` / `ingest.controller.ts`）
- **upload 流程**：PDF 上传后先归档原文到 `UPLOAD_DIR/ingest/pdfs/{jobId}.pdf`（**英文 id 命名**，避免中文文件名问题），再调用 OCR 容器 `/pdf-to-images` 逐页转图，每页 PNG 存 `UPLOAD_DIR/ingest/pages/{jobId}-pNN.png`，并创建**多页 `ingestPage`**（pageNumber 递增、pageCount 写入任务）。
- 转图后整条流水线（框选 / 按框裁切单题 / AI 识题）全部复用现有图片逻辑，不再走 PDF 分支。
- **detect 修正**：mimeType 判断由 `job.fileType === 'pdf'` 改为 `isPdf(page.imagePath)`（按扩展名），转图后正确传 `image/png` 给 OCR/VLM。
- **multer 防御**：`FileInterceptor` 显式 `limits: { fileSize: 50MB }`，超限抛 413。

### 4. 前端（`client.ts` / `ingest.ts`）
- axios 拦截器对 `413` 输出友好提示「文件过大（单文件上限 50MB），请压缩或拆分后重试」（nginx 直返 413 响应体非 JSON，原逻辑拿不到 message）。
- 上传请求超时放宽到 180s（PDF 上传含逐页转图）。

## 验证结果（Docker 栈实测）

| 验证项 | 结果 |
| --- | --- |
| 3MB 请求穿透 nginx | ✅ 401（原为 413），`client_max_body_size 50m` 已加载 |
| 3 页中文 PDF 上传 | ✅ `pageCount=3`，fileType=pdf |
| PDF 原文归档 | ✅ `ingest/pdfs/{jobId}.pdf`（英文 id） |
| 逐页转图落盘 | ✅ `ingest/pages/{jobId}-p01/02/03.png`（A4@150dpi ≈ 48KB/张） |
| 页面原图接口 | ✅ 返回合法 PNG |
| 自动框选（本地 PaddleOCR） | ✅ 3 页出 21 框，bbox 归一化正常 |

## 备注

- 部署生效方式：`putout/` 部署包 7 个文件已同步一致（MD5 校验通过），重新 `docker compose up -d --build`（backend/ocr/frontend 需 `--no-cache` 重建，OneDrive 同步会导致 BuildKit 缓存误命中）后正式生效。
- 冒烟期间容器用 `docker cp` 热更新的新代码/依赖仅存在于容器可写层，重启镜像级重建会还原；正式部署以 `putout/` 重建为准。
