# 「AI 框选题目」改为本地 OCR 两阶段服务 — 变更说明

> 日期：2026-08-16 · 关联：detect 选框从云端 VLM 迁移到本地 PaddleOCR

## 一句话总结

试卷上传后点「AI 框选题目」，现在由**本地 PaddleOCR 两阶段服务**出框（OCR 框住所有文字 → 题号/标题正则分组 → 圈出单题框+标题框），**不再走云端视觉模型、不需要任何 AI 密钥**。AI 识题（recognize）仍走云端 VLM，二者解耦。

## 改动清单

| 文件 | 改动 |
|------|------|
| `ocr/app.py`（新增，putout 与根目录各一份） | FastAPI 服务：`GET /health`、`POST /detect`（multipart 收图 → PaddleOCR → 碎片合并 → 正则分组 → 归一化输出 `{boxes:[{bbox,type,confidence,number}]}`） |
| `ocr/requirements.txt`（新增） | paddleocr==3.7.0 + paddlepaddle==3.3.1 + numpy==2.2.6 + fastapi 等 |
| `docker/Dockerfile.ocr`（新增） | python:3.12-slim + apt libgl/libgomp + pip install |
| `backend/src/modules/ingest/vlm/ocr-detect.service.ts`（新增） | 读 imagePath/buffer → multipart 上传给 OCR 服务（120s 超时），映射为 `DetectedBox[]` |
| `backend/src/modules/ingest/vlm/vlm.service.ts` | `detect()` 改走 ocrDetect；`recognize()` 保留云端 VLM |
| `backend/src/modules/ingest/ingest.module.ts` | 注册 `OcrDetectService` |
| `docker-compose.yml`（putout + 根目录） | 新增 `ocr` 服务（内存 1.5G，healthcheck start_period=90s）+ backend 注入 `OCR_SERVICE_URL=http://ocr:8000` |
| `.env.example`（两处） | 补 `OCR_SERVICE_URL` |
| `README.deploy.md` | 目录结构、第 6 节、7 步流水线、故障排查、运维命令同步更新 |

前端**零改动**：`detect` 对外接口（`{job, rawReply}`）与 bbox 格式（`[x0,y0,x1,y1]` 归一化）完全不变。

## 验证结论

- ✅ 后端 `tsc --noEmit` 通过（exit 0）
- ✅ Python 核心逻辑跑真实试卷图 → 10 框（3 标题 + Q5–Q11），坐标与 POC v1 一致，题型推断全对（Q5-7=多选、Q8-10=填空、Q11=解答）
- ✅ 本地起 uvicorn 端到端 curl `/health` + `/detect` multipart 上传 → 正确 JSON
- ✅ `docker compose config`（putout + 根目录）语法通过
- ✅ **2026-08-16 晚已在 Docker Desktop 完整部署并端到端验证**：五容器 healthy；backend 容器内模拟生产链路调 `ocr:8000/detect` → HTTP 200、10 框、坐标与题型全部正确

## 部署要点

```bash
cd /path/to/putout
docker compose up -d --build   # 会多构建一个约 1.5G 的 exam-ocr 镜像，首次较慢
docker compose ps              # 确认五服务（postgres/redis/backend/frontend/ocr）全部 healthy
```

OCR 服务首次启动加载 PaddleOCR 模型约需数十秒（healthcheck `start_period=90s` 已覆盖），之后常驻。CPU 推理整页约 60–90s，点「AI 框选题目」时后端有 120s 超时兜底。

> **⚠️ 实际部署踩坑（已修复进代码/配置）**：
> 1. **BuildKit 缓存误命中**：backend 源码改动被 Docker 缓存漏掉（OneDrive 同步导致 `COPY backend/ ./` 误命中）→ 部署后须验证容器内 `dist/modules/ingest/vlm/ocr-detect.service.js` 存在；若缺失 `docker compose build --no-cache backend` 强制重建。
> 2. **国内镜像源**：OCR 镜像 pip 用阿里云源（`-i https://mirrors.aliyun.com/pypi/simple/ --timeout 120 --retries 5`）；backend `prisma generate` 加 `ENV PRISMA_ENGINES_MIRROR=https://npmmirror.com/mirrors/prisma`（binaries.prisma.sh 跨境 TLS 断开）。
> 3. **OCR 容器 OOM**：PaddleOCR 处理大图内存峰值 >1.5G → compose 把 ocr 内存提到 **3000m**，且 `ocr/app.py` 加 `MAX_EDGE=2400` 图片尺寸保护（超长边等比缩小，坐标归一化不受影响）。

## 关键实现细节（踩坑记录）

1. **PaddleOCR 3.7 是新 API**：`PaddleOCR(use_textline_orientation=True, lang="ch", enable_mkldnn=False)` + `ocr.predict(img)`（返回 `list[dict]`，键为 `dt_polys`/`rec_texts`/`rec_scores`），**不是**旧版 `use_angle_cls` + `ocr.ocr()`。
2. 需在 import paddleocr 前设 `PADDLE_DISABLE_ONEDNN=1`。
3. 题型推断正则：`多项选择|多选` 要放 `单选|选择` 之前，且「多项选择题」必须用 `多项选择` 匹配（`多选` 匹配不到「多」「选」中间隔着「项」的情况）。
4. 后端 multipart 上传：`Buffer` 不能直接当 `BlobPart`，需 `Uint8Array.from(buffer)` 转一次（TypeScript 类型约束）。
