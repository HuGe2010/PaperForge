#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
试卷题目框选服务（OCR 两阶段）

Stage1: PaddleOCR 把整页所有文字各自框出（逐行/逐碎片）
Stage2: 用题号等正则判断哪些文字框同属一题，取它们外围矩形 = 单题框；
        章节标题行（如「二、多项选择题」）另成标题框，并用于推断后续题目的题型

对外接口（FastAPI）：
  GET  /health        健康检查
  POST /detect        接收图片文件（multipart 字段名 file），返回题目框
                      请求体: multipart/form-data, file=图片二进制
                      响应: {"model": "...", "boxes": [{"bbox":[x0,y0,x1,y1], "type": "...", "confidence": 0.9, "number": int|null}, ...]}
  POST /pdf-to-images 接收 PDF 文件（multipart 字段名 file），逐页转 PNG 返回
                      请求体: multipart/form-data, file=PDF二进制, dpi=可选(默认150)
                      响应: {"count": N, "pages": [{"page":1, "width":W, "height":H, "image":"base64 png"}, ...]}

坐标均为相对原图宽高的归一化值（0-1），与后端 OcrItem.bbox 一致。

设计说明：
  - PaddleOCR 实例为全局懒加载单例（首次调用时初始化，约数秒）。
  - 服务本身无状态：图片由调用方（NestJS 后端）以 multipart 上传，不在本地落盘。
  - 题型推断仅依据章节标题文本（如「多选」→ MULTIPLE_CHOICE），无法推断时留空（前端显示「未识别」）。
  - PDF 转图仅用 PyMuPDF（fitz），不依赖 poppler 等系统库。
"""
import base64
import io
import os
import re

# 与 POC 保持一致：禁用 OneDNN，规避 PaddleOCR CPU 推理的兼容性告警/报错
os.environ.setdefault("PADDLE_DISABLE_ONEDNN", "1")

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Exam OCR Detect Service", version="1.0.0")

# 允许跨容器调用（NestJS 后端 -> 本服务）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------------------------------------------------------
# 正则：章节标题行 / 题号行
# ----------------------------------------------------------------------------
TITLE_RE = re.compile(r"^[一二三四五六七八九十]+、")   # 章节标题行，如「二、多项选择题」
QRE = re.compile(r"^\s*(\d{1,3})\s*[\.、]")           # 题号行（开启新一题），如「5.」「12、」

# 章节标题文本 -> 题型枚举（顺序敏感：先匹配更具体的「多项选择」）
SECTION_TYPE_RULES = [
    (re.compile(r"多项选择|多选"), "MULTIPLE_CHOICE"),
    (re.compile(r"单项选择|单选|选择"), "SINGLE_CHOICE"),
    (re.compile(r"填空"), "FILL_BLANK"),
    (re.compile(r"判断"), "TRUE_FALSE"),
    (re.compile(r"阅读"), "READING_COMPREHENSION"),
    (re.compile(r"解答|计算|简答|应用"), "SHORT_ANSWER"),
    (re.compile(r"作文|论述"), "ESSAY"),
    (re.compile(r"材料"), "MATERIAL"),
]

# 大题题型：整个大题只框一个框（材料 + 全部小题），小题不再单独框选
BIG_QUESTION_TYPES = {"READING_COMPREHENSION", "MATERIAL", "SHORT_ANSWER", "ESSAY"}


def infer_type(section_title: str):
    for pat, qt in SECTION_TYPE_RULES:
        if pat.search(section_title or ""):
            return qt
    return None


# ----------------------------------------------------------------------------
# PaddleOCR 懒加载单例
# ----------------------------------------------------------------------------
_OCR = None


def get_ocr():
    global _OCR
    if _OCR is None:
        from paddleocr import PaddleOCR

        _OCR = PaddleOCR(
            use_textline_orientation=True,
            lang="ch",
            enable_mkldnn=False,
        )
    return _OCR


# ----------------------------------------------------------------------------
# Stage1: 运行 OCR，返回逐碎片文字框
# ----------------------------------------------------------------------------
def ocr_fragments(img: np.ndarray):
    """运行 PaddleOCR，返回逐碎片文字框列表:
       {"x1","y1","x2","y2","w","h","text","score"}（像素坐标）
    """
    ocr = get_ocr()
    result = ocr.predict(img)
    # PaddleOCR 3.x 的 predict() 返回 list[dict]，每张图一个 dict：
    #   { "dt_polys": [...], "rec_texts": [...], "rec_scores": [...] }
    item = result[0] if isinstance(result, list) else result
    if not isinstance(item, dict):
        return []

    polys = item.get("dt_polys") or item.get("polygons") or []
    texts = item.get("rec_texts") or item.get("texts") or []
    scores = item.get("rec_scores") or item.get("scores") or []

    frags = []
    for i in range(max(len(polys), len(texts))):
        poly = polys[i] if i < len(polys) else None
        if poly is None:
            continue
        xs = [float(p[0]) for p in poly]
        ys = [float(p[1]) for p in poly]
        x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
        txt = texts[i] if i < len(texts) else ""
        sc = scores[i] if i < len(scores) else 0.0
        try:
            score = float(sc)
        except (TypeError, ValueError):
            score = 0.0
        frags.append(
            {
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
                "w": x2 - x1,
                "h": y2 - y1,
                "text": txt,
                "score": score,
            }
        )

    frags.sort(key=lambda b: (round(b["y1"]), b["x1"]))
    return frags


# ----------------------------------------------------------------------------
# 碎片合并为干净整行（处理 PaddleOCR 把单行拆成多个单字框的情况）
# ----------------------------------------------------------------------------
def merge_lines(frags, gap: int = 50, y_ratio: float = 0.4):
    merged = []
    for b in frags:
        placed = False
        # 只看最近 4 行，避免与太靠前的行误合并
        for L in reversed(merged[-4:]):
            ov = max(0.0, min(b["y2"], L["y2"]) - max(b["y1"], L["y1"]))
            b_h = b["y2"] - b["y1"]
            l_h = L["y2"] - L["y1"]
            ratio = ov / min(b_h, l_h) if min(b_h, l_h) > 0 else 0
            horiz_close = b["x1"] <= L["x2"] + gap
            inside_x = (b["x1"] >= L["x1"] - gap) and (b["x2"] <= L["x2"] + gap)
            if ratio >= y_ratio and (horiz_close or inside_x):
                L["x1"] = min(L["x1"], b["x1"])
                L["y1"] = min(L["y1"], b["y1"])
                L["x2"] = max(L["x2"], b["x2"])
                L["y2"] = max(L["y2"], b["y2"])
                L["texts"].append(b["text"])
                L["score"] = min(L["score"], b["score"])
                placed = True
                break
        if not placed:
            merged.append(
                {
                    "x1": b["x1"],
                    "y1": b["y1"],
                    "x2": b["x2"],
                    "y2": b["y2"],
                    "texts": [b["text"]],
                    "score": b["score"],
                }
            )
    return merged


# ----------------------------------------------------------------------------
# Stage2: 按题号/标题正则分组，输出单题框 + 标题框
# ----------------------------------------------------------------------------
def group_boxes(merged, H: int, W: int):
    titles = []
    questions = []
    cur = None
    cur_section_type = None

    for L in merged:
        text = "".join(L["texts"]).strip()
        if TITLE_RE.match(text):
            # 章节标题：结束当前题，独立成标题框，并记录后续题型
            if cur:
                questions.append(cur)
                cur = None
            titles.append(
                {
                    "bbox_px": [L["x1"], L["y1"], L["x2"], L["y2"]],
                    "text": text,
                }
            )
            cur_section_type = infer_type(text)
            continue

        # 大题题型（阅读/材料/解答/论述）：标题下所有行并入一个框，小题（含 "1." 编号）不再开新框
        big = cur_section_type in BIG_QUESTION_TYPES
        m = QRE.match(text)
        if m and not big:
            if cur:
                questions.append(cur)
            cur = {
                "num": int(m.group(1)),
                "lines": [L],
                "preview": text,
                "type": cur_section_type,
            }
        else:
            if cur is None:
                cur = {
                    "num": None,
                    "lines": [L],
                    "preview": text,
                    "type": cur_section_type,
                }
            else:
                cur["lines"].append(L)
                cur["preview"] += " " + text
    if cur:
        questions.append(cur)

    boxes = []

    # 标题框（不赋题型，前端显示「未识别」，用户可删除）
    for t in titles:
        x1, y1, x2, y2 = [float(v) for v in t["bbox_px"]]
        boxes.append(
            {
                "bbox": [
                    round(x1 / W, 4),
                    round(y1 / H, 4),
                    round(x2 / W, 4),
                    round(y2 / H, 4),
                ],
                "type": None,
                "confidence": 0.9,
                "number": None,
            }
        )

    # 单题框（题型取自所属章节标题）
    for q in questions:
        xs = [pt for L in q["lines"] for pt in (L["x1"], L["x2"])]
        ys = [pt for L in q["lines"] for pt in (L["y1"], L["y2"])]
        x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
        boxes.append(
            {
                "bbox": [
                    round(x1 / W, 4),
                    round(y1 / H, 4),
                    round(x2 / W, 4),
                    round(y2 / H, 4),
                ],
                "type": q["type"],
                "confidence": 0.9,
                "number": q["num"],
            }
        )

    return boxes


# ----------------------------------------------------------------------------
# 题图识别（启发式）：检测无文字覆盖的大块图像区域（题目附图），归一化返回
# ----------------------------------------------------------------------------
def detect_figures(img, text_lines, H, W):
    """检测无文字的大块图像区域（题目附图）。返回归一化 bbox 列表 [[x0,y0,x1,y1], ...]"""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 80, 200)
    kernel = np.ones((5, 5), np.uint8)
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    area = float(H * W)
    cands = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if w * h < area * 0.004 or w * h > area * 0.5:  # 面积过滤：0.4%~50% 页面积
            continue
        if w < 40 or h < 40:  # 尺寸下限
            continue
        if max(w, h) / max(1, min(w, h)) > 10:  # 过细长（分隔线/装订边）
            continue
        cands.append((x, y, w, h))

    out = []
    for (x, y, w, h) in cands:
        overlap = 0.0
        for L in text_lines:
            ix = max(0, min(x + w, L["x2"]) - max(x, L["x1"]))
            iy = max(0, min(y + h, L["y2"]) - max(y, L["y1"]))
            overlap += ix * iy
        ratio = overlap / (w * h) if w * h > 0 else 1
        if ratio < 0.08:  # 文字覆盖 < 8% 视为图片区域
            out.append([x / W, y / H, (x + w) / W, (y + h) / H])
    return out


# ----------------------------------------------------------------------------
# 表格检测（表格也算题图，如统计表/数据表）：横竖线密集的网格区域
# ----------------------------------------------------------------------------
def detect_tables(img, H, W):
    """检测表格区域（横竖线交叉的网格），返回归一化 bbox 列表 [[x0,y0,x1,y1], ...]"""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, bin_img = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    horiz_k = cv2.getStructuringElement(cv2.MORPH_RECT, (60, 1))
    vert_k = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 60))
    horiz = cv2.morphologyEx(bin_img, cv2.MORPH_OPEN, horiz_k)
    vert = cv2.morphologyEx(bin_img, cv2.MORPH_OPEN, vert_k)
    lines = cv2.bitwise_or(horiz, vert)
    kernel = np.ones((9, 9), np.uint8)
    closed = cv2.morphologyEx(lines, cv2.MORPH_CLOSE, kernel, iterations=3)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    area = float(H * W)
    out = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if w * h < area * 0.01 or w * h > area * 0.6:  # 表格通常 ≥1% 页面积
            continue
        if w < 80 or h < 50:
            continue
        out.append([x / W, y / H, (x + w) / W, (y + h) / H])
    return out


def _iou(a, b):
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix = max(0, min(ax1, bx1) - max(ax0, bx0))
    iy = max(0, min(ay1, by1) - max(ay0, by0))
    inter = ix * iy
    ua = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter
    return inter / ua if ua > 0 else 0


def merge_boxes(boxes):
    """合并重叠度过高的候选框（IoU > 0.5 取并集）"""
    boxes = [list(b) for b in boxes]
    changed = True
    while changed and len(boxes) > 1:
        changed = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                if _iou(boxes[i], boxes[j]) > 0.5:
                    a, b = boxes[i], boxes[j]
                    boxes[i] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                    boxes.pop(j)
                    changed = True
                    break
            if changed:
                break
    return boxes


# ----------------------------------------------------------------------------
# 主流程
# ----------------------------------------------------------------------------
MAX_EDGE = 2400  # 最长边像素上限：超大图（如 PDF 高清页）先等比缩小，控制内存峰值


def detect_image(data: bytes):
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("无法解码图片（格式不支持）")
    H, W = img.shape[:2]

    # 超大图等比缩小（归一化坐标基于缩小后尺寸，返回时仍为 0-1，前端不受影响）
    longest = max(H, W)
    if longest > MAX_EDGE:
        scale = MAX_EDGE / longest
        img = cv2.resize(img, (int(W * scale), int(H * scale)), interpolation=cv2.INTER_AREA)
        H, W = img.shape[:2]

    frags = ocr_fragments(img)
    if not frags:
        return {"model": "paddleocr-v1", "boxes": []}

    merged = merge_lines(frags)
    boxes = group_boxes(merged, H, W)

    # 题图：无文字图像区域 + 表格网格（表格也算题图），按其中心纵坐标挂到所属题框的 figures
    figures = merge_boxes(detect_figures(img, merged, H, W) + detect_tables(img, H, W))
    for f in figures:
        fy = f[1] + (f[3] - f[1]) / 2
        for b in boxes:
            # 只挂到题目框（题号或标题框不挂），且图片中心位于题框内
            if b.get("number") is not None or b.get("title"):
                continue
            bb = b["bbox"]
            if bb[1] - 0.01 <= fy <= bb[3] + 0.01:
                b.setdefault("figures", []).append({"bbox": [round(v, 4) for v in f], "label": "题内图片"})
                break

    return {"model": "paddleocr-v1", "boxes": boxes}


# ----------------------------------------------------------------------------
# HTTP 接口
# ----------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok", "paddleocr_loaded": _OCR is not None}


@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    try:
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="空文件")
        result = detect_image(data)
        return result
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"OCR 检测失败: {e}")


# ----------------------------------------------------------------------------
# PDF 逐页转图（供后端上传 PDF 时调用）
# ----------------------------------------------------------------------------
@app.post("/pdf-to-images")
async def pdf_to_images(file: UploadFile = File(...), dpi: int = 150):
    import fitz  # PyMuPDF（延迟导入，避免拖慢 /health 与 /detect 首字节）

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="空文件")

    # dpi 限制在 72~300：过低识别不清，过高内存/带宽爆炸
    dpi = max(72, min(int(dpi or 150), 300))

    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"无法解析 PDF: {e}")

    pages = []
    for pno in range(len(doc)):
        page = doc[pno]
        pix = page.get_pixmap(dpi=dpi)
        png_bytes = pix.tobytes("png")
        pages.append(
            {
                "page": pno + 1,
                "width": pix.width,
                "height": pix.height,
                "image": base64.b64encode(png_bytes).decode("ascii"),
            }
        )
    doc.close()

    if not pages:
        raise HTTPException(status_code=400, detail="PDF 未解析出任何页面")

    return {"count": len(pages), "pages": pages}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("OCR_PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
