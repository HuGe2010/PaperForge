import { BadRequestException } from '@nestjs/common';
import { QuestionType } from '@prisma/client';
import {
  BBox,
  DetectInput,
  DetectResult,
  DetectedBox,
  VLMProvider,
  RecognizeInput,
  RecognizeResult,
} from './vlm-provider.interface';
import { imageSizeFromBuffer } from './real-vlm.provider';

/** 云端 OCR 配置：PaddleOCR-VL（百度 AI Studio 异步 job 接口） */
export interface PaddleOcrVlConfig {
  apiUrl: string; // JOB_URL，如 https://paddleocr.aistudio-app.com/api/v2/ocr/jobs
  token: string; // access token（请求头 Authorization: bearer <token>）
  model?: string; // 默认 PaddleOCR-VL-1.6，不写死、由用户后台填写
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 章节标题文本 -> 题型枚举（顺序敏感：先匹配更具体的「多项选择」）
const SECTION_TYPE_RULES: [RegExp, string][] = [
  [/多项选择|多选/, 'MULTIPLE_CHOICE'],
  [/单项选择|单选|选择/, 'SINGLE_CHOICE'],
  [/填空/, 'FILL_BLANK'],
  [/判断/, 'TRUE_FALSE'],
  [/阅读/, 'READING_COMPREHENSION'],
  [/解答|计算|简答|应用/, 'SHORT_ANSWER'],
  [/作文|论述/, 'ESSAY'],
  [/材料/, 'MATERIAL'],
];

/** 大题题型：整大题只框一个框（材料 + 全部小题），小题不再单独框选 */
const BIG_QUESTION_TYPES = new Set(['READING_COMPREHENSION', 'MATERIAL', 'SHORT_ANSWER', 'ESSAY']);

/** 题号行（开启新一题），如「5.」「12、」 */
const QRE = /^\s*(\d{1,3})\s*[.、．]/;

/**
 * 云端版面检测提供方：调用 PaddleOCR-VL 的异步 job 接口。
 * 流程（对照官方示例）：
 *   1) POST {apiUrl} 提交 multipart/form-data（file 图片文件 + model + optionalPayload(JSON 字符串)）
 *   2) 轮询 GET {apiUrl}/{jobId}，state 依次 pending/running/done（failed 则报错）
 *   3) done 后取 resultUrl.jsonUrl 下载 JSONL 结果（每行一个页面）
 *   4) 解析第一页 layoutParsingResults[0].prunedResult.parsing_res_list
 * 只做「题目框选」——识别试卷标题(doc_title)、大题标题(paragraph_title)、正文块(text)。
 */
export class PaddleOcrVlProvider implements VLMProvider {
  readonly name = 'paddleocr-vl';

  constructor(private readonly config: PaddleOcrVlConfig) {}

  async detect(input: DetectInput): Promise<DetectResult> {
    if (!this.config.apiUrl || !this.config.token) {
      throw new BadRequestException('未配置云端 OCR（系统设置 → OCR 方案）：请填写 API URL 与 Token');
    }

    const buf = await this.readBuffer(input);
    if (!buf) throw new BadRequestException('缺少识别图像');
    const dims = this.probeDims(buf);
    const model = this.config.model || 'PaddleOCR-VL-1.6';
    const optionalPayload = {
      useDocOrientationClassify: false,
      useDocUnwarping: false,
      useChartRecognition: false,
    };

    // 1. 提交 job（本地文件模式：multipart/form-data，不手动设 Content-Type）
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type: 'application/octet-stream' }), 'page.png');
    form.append('model', model);
    form.append('optionalPayload', JSON.stringify(optionalPayload));

    const submitResp = await fetch(this.config.apiUrl, {
      method: 'POST',
      headers: { Authorization: `bearer ${this.config.token}` },
      body: form,
    });
    if (!submitResp.ok) {
      throw new BadRequestException(
        `PaddleOCR-VL 提交失败 ${submitResp.status}: ${(await submitResp.text().catch(() => '')).slice(0, 300)}`,
      );
    }
    const submitData: any = await submitResp.json();
    const jobId: string | undefined = submitData?.data?.jobId;
    if (!jobId) {
      throw new BadRequestException(`PaddleOCR-VL 提交异常：${JSON.stringify(submitData).slice(0, 300)}`);
    }

    // 2. 轮询 job 结果（云端解析慢时可达数分钟，最多 200 次 × 3s = 10 分钟，与前端/nginx 超时对齐）
    const jobUrl = `${this.config.apiUrl.replace(/\/+$/, '')}/${jobId}`;
    let jsonUrl = '';
    for (let i = 0; i < 200; i++) {
      const pollResp = await fetch(jobUrl, {
        headers: { Authorization: `bearer ${this.config.token}` },
      });
      if (!pollResp.ok) {
        throw new BadRequestException(
          `PaddleOCR-VL 查询任务失败 ${pollResp.status}: ${(await pollResp.text().catch(() => '')).slice(0, 200)}`,
        );
      }
      const pollData: any = await pollResp.json();
      const state = pollData?.data?.state;
      if (state === 'done') {
        jsonUrl = pollData?.data?.resultUrl?.jsonUrl || '';
        break;
      }
      if (state === 'failed') {
        throw new BadRequestException(`PaddleOCR-VL 任务失败：${pollData?.data?.errorMsg || '未知错误'}`);
      }
      await sleep(3000);
    }
    if (!jsonUrl) throw new BadRequestException('PaddleOCR-VL 任务超时（超过 10 分钟）');

    // 3. 下载 JSONL 结果（官方示例 requests.get(jsonl_url) 不带鉴权头——jsonUrl 是预签名链接）
    const jsonlResp = await fetch(jsonUrl);
    if (!jsonlResp.ok) {
      throw new BadRequestException(
        `PaddleOCR-VL 下载结果失败 ${jsonlResp.status}: ${(await jsonlResp.text().catch(() => '')).slice(0, 300)}`,
      );
    }
    const jsonlText = await jsonlResp.text();

    // 4. 解析第一个有效页面的 layoutParsingResults[0]
    const first = this.firstLayoutResult(jsonlText);
    if (!first) throw new BadRequestException('PaddleOCR-VL 返回结果为空');
    const pruned = first?.prunedResult || {};
    const parsing: any[] = pruned?.parsing_res_list || first?.parsing_res_list || [];

    // 优先用 parsing_res_list：每个块同时含 block_bbox + block_label + block_content，
    // 后处理分组：大题（阅读/材料/解答/论述）整大题一个框、选择题等每题一框、题图单独标记。
    const grouped = this.groupCloudBoxes(parsing, dims);
    if (grouped.boxes.length > 0) {
      return {
        model,
        paperName: grouped.paperName,
        boxes: grouped.boxes,
        pageFigures: grouped.pageFigures,
        raw: JSON.stringify({
          blocks: grouped.boxes.length,
          figures: grouped.pageFigures.length,
          paperName: grouped.paperName,
        }),
      };
    }

    // 退路：parsing_res_list 为空时，用 layout_det_res.boxes（仅坐标+label，无文本）
    const outBoxes: DetectedBox[] = [];
    const boxes: any[] = pruned?.layout_det_res?.boxes || [];
    for (const b of boxes) {
      const label: string = b?.label ?? '';
      const coord = Array.isArray(b?.coordinate) ? b.coordinate : null;
      const bbox = this.toBBox(coord, dims);
      if (!bbox) continue;
      const score = typeof b?.score === 'number' ? b.score : 0.9;
      if (label === 'doc_title') {
        outBoxes.push({ bbox, type: undefined, confidence: score, number: null, title: '标题' });
      } else if (label === 'paragraph_title') {
        outBoxes.push({ bbox, type: undefined, confidence: score, number: null, title: '大题' });
      } else if (label === 'text') {
        outBoxes.push({ bbox, type: undefined, confidence: score, number: null, title: null });
      }
    }

    return {
      model,
      paperName: grouped.paperName,
      boxes: outBoxes,
      pageFigures: grouped.pageFigures,
      raw: JSON.stringify({ blocks: outBoxes.length, paperName: grouped.paperName }),
    };
  }

  /**
   * 云端版面块 → 题目框分组：
   * - doc_title → 试卷标题框；paragraph_title → 大题标题框（推断题型，标记分组）；
   * - 大题题型（阅读/材料/解答/论述）：标题下所有文本块合并为一个框，小题不单独框；
   * - 小题型（选择/判断/填空）：文本块按题号正则分组，每题一框；
   * - 图片块（figure/image/chart/table/formula）：不绑定题目，统一收拢为页面级 pageFigures。
   */
  private groupCloudBoxes(
    blocks: any[],
    dims?: { width: number; height: number },
  ): { paperName?: string; boxes: DetectedBox[]; pageFigures: Array<{ bbox: BBox; label?: string }> } {
    const inferType = (title: string): string | undefined => {
      for (const [pat, qt] of SECTION_TYPE_RULES) {
        if (pat.test(title || '')) return qt;
      }
      return undefined;
    };

    // 归一化 + 排序（自上而下、再自左而右）
    const norm: { label: string; text: string; bbox: BBox }[] = [];
    for (const b of blocks) {
      const label: string = b?.block_label ?? '';
      const content = typeof b?.block_content === 'string' ? b.block_content.trim() : '';
      const coord = Array.isArray(b?.block_bbox) ? b.block_bbox : null;
      const bbox = this.toBBox(coord, dims);
      if (!bbox) continue;
      norm.push({ label, text: content, bbox });
    }
    norm.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);

    interface Group {
      title?: string;
      type?: string;
      lines: { bbox: BBox; text: string }[];
    }
    let paperName: string | undefined;
    /** 页面级图片区域：与题目框解耦，落库到 IngestPage.figures */
    const pageFigures: Array<{ bbox: BBox; label?: string }> = [];
    const titleBoxes: DetectedBox[] = [];
    const groups: Group[] = [];
    let cur: Group | null = null;
    let sectionType: string | undefined;

    const closeGroup = () => {
      if (cur && cur.lines.length) groups.push(cur);
      cur = null;
    };

    for (const b of norm) {
      if (b.label === 'doc_title') {
        if (b.text && !paperName) paperName = b.text;
        titleBoxes.push({ bbox: b.bbox, type: undefined, confidence: 0.9, number: null, title: b.text || '标题' });
        continue;
      }
      if (b.label === 'paragraph_title' || b.label === 'title') {
        // 大题标题：结束当前组，开新组（标题框本身作为分组标记，不建题）
        closeGroup();
        sectionType = inferType(b.text);
        cur = { title: b.text, type: sectionType, lines: [] };
        titleBoxes.push({
          bbox: b.bbox,
          type: sectionType as QuestionType | undefined,
          confidence: 0.9,
          number: null,
          title: b.text || '大题',
        });
        continue;
      }
      // 图片/图表/公式/表格块：不绑定题目，统一作为页面级图片区域
      if (b.label === 'figure' || b.label === 'image' || b.label === 'chart' || b.label === 'formula' || b.label === 'table') {
        pageFigures.push({ bbox: b.bbox, label: '题内图片' });
        continue;
      }
      if (b.label === 'text' || b.label === 'paragraph' || b.label === 'content') {
        if (!cur) cur = { type: sectionType, lines: [] };
        // 大题题型：整大题一个框，不按题号拆
        if (cur.type && BIG_QUESTION_TYPES.has(cur.type)) {
          cur.lines.push({ bbox: b.bbox, text: b.text });
          continue;
        }
        // 小题型（或未识别）：按题号开新题
        const m = QRE.test(b.text);
        if (m && cur.lines.length) {
          groups.push(cur);
          cur = { type: sectionType, lines: [{ bbox: b.bbox, text: b.text }] };
        } else {
          cur.lines.push({ bbox: b.bbox, text: b.text });
        }
      }
    }
    closeGroup();

    // 组内行纵向空隙过大（>40% 页高）说明夹着其他内容：拆成多个框，避免框得过大
    const boxes: DetectedBox[] = [...titleBoxes];
    for (const g of groups) {
      const lineBBoxes = [...g.lines].sort((a, b) => a.bbox[1] - b.bbox[1]);
      const subRuns: { bbox: BBox; text: string }[][] = [];
      let run: { bbox: BBox; text: string }[] = [];
      for (let i = 0; i < lineBBoxes.length; i++) {
        if (run.length && lineBBoxes[i].bbox[1] - run[run.length - 1].bbox[3] > 0.4) {
          subRuns.push(run);
          run = [];
        }
        run.push(lineBBoxes[i]);
      }
      if (run.length) subRuns.push(run);
      subRuns.forEach((lines, si) => {
        const xs = lines.flatMap((l) => [l.bbox[0], l.bbox[2]]);
        const ys = lines.flatMap((l) => [l.bbox[1], l.bbox[3]]);
        boxes.push({
          bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
          type: g.type as QuestionType | undefined,
          confidence: 0.9,
          number: null,
        });
      });
    }
    return { paperName, boxes, pageFigures };
  }

  /** 云端方案不做内容识别（recognize 仍走 VLM），此处不实现 */
  async recognize(_input: RecognizeInput): Promise<RecognizeResult> {
    throw new BadRequestException('PaddleOCR-VL 仅用于框选(detect)，不用于内容识别(recognize)');
  }

  // ---- 内部 ----

  /** 从 JSONL 文本中取第一个有效页面的 layoutParsingResults[0] */
  private firstLayoutResult(jsonl: string): any | null {
    for (const line of jsonl.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        const obj = JSON.parse(s);
        const arr = obj?.result?.layoutParsingResults;
        if (Array.isArray(arr) && arr.length) return arr[0];
      } catch {
        /* 跳过无法解析的行 */
      }
    }
    return null;
  }

  private async readBuffer(input: DetectInput): Promise<Buffer | null> {
    if (input.buffer) return input.buffer;
    if (input.imagePath) {
      const fs = await import('fs/promises');
      return fs.readFile(input.imagePath);
    }
    return null;
  }

  private probeDims(buf: Buffer): { width: number; height: number } | undefined {
    try {
      return imageSizeFromBuffer(buf);
    } catch {
      return undefined;
    }
  }

  /** 像素坐标 [x1,y1,x2,y2] → 归一化 [0,1]；无法解析尺寸时按原样（假设已归一化） */
  private toBBox(coord: number[] | null, dims?: { width: number; height: number }): BBox | null {
    if (!coord || coord.length !== 4) return null;
    const [x1, y1, x2, y2] = coord.map(Number);
    if (dims && dims.width > 0 && dims.height > 0 && (x2 > 1.5 || y2 > 1.5)) {
      return [x1 / dims.width, y1 / dims.height, x2 / dims.width, y2 / dims.height];
    }
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  }
}
