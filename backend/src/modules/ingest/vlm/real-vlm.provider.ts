import { BadRequestException } from '@nestjs/common';
import { QuestionType } from '@prisma/client';
import path from 'path';
import {
  BBox,
  DetectedBox,
  DetectInput,
  DetectResult,
  DetectedQuestion,
  RecognizeInput,
  RecognizeResult,
  VLMProvider,
} from './vlm-provider.interface';

export interface RealVlmConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

/** 题型中文名（识别提示词用，让模型明确「这是哪类题」） */
const TYPE_CN: Record<string, string> = {
  SINGLE_CHOICE: '单选题',
  MULTIPLE_CHOICE: '多选题',
  TRUE_FALSE: '判断题',
  FILL_BLANK: '填空题',
  SHORT_ANSWER: '简答题',
  ESSAY: '论述题',
  MATERIAL: '材料题',
  READING_COMPREHENSION: '阅读理解',
};

/** system 角色：约束输出格式，杜绝 markdown 代码块与像素坐标 */
export const DETECT_SYSTEM_PROMPT =
  '你是一个试卷版面分析引擎。严格按以下要求输出：\n' +
  '1. 只输出一个 JSON 对象，不要输出任何解释、前缀或后缀。\n' +
  '2. 严禁使用 markdown 代码块（不要出现 ``` 符号），直接输出纯 JSON 文本。\n' +
  '3. 所有坐标必须是 0 到 1 之间的小数（相对整张原图宽高的比例），严禁输出像素值（如 120、640 等整数）。';

/** user 角色：任务说明 + 输出格式 + 示例 */
export const DETECT_USER_PROMPT =
  '检测图片中的题目，并尽量识别试卷标题。\n' +
  '输出严格 JSON：{"paperName":"试卷标题(若图顶部可见则填，如 2023年普通高等学校招生全国统一考试·数学(理)；不可见则留空字符串)","boxes":[{"bbox":[x0,y0,x1,y1],"type":"题型枚举","confidence":0.0~1.0}, ...],"pageFigures":[{"bbox":[x0,y0,x1,y1],"label":"图片说明"}, ...]}。\n' +
  '规则：\n' +
  '- bbox 为归一化坐标(0-1)：[x0,y0] 为左上角，[x1,y1] 为右下角，坐标保留两位小数。\n' +
  '- type 从 SINGLE_CHOICE/MULTIPLE_CHOICE/TRUE_FALSE/FILL_BLANK/SHORT_ANSWER/ESSAY/MATERIAL/READING_COMPREHENSION 中选择，不确定可省略。\n' +
  '- 忽略页眉页脚、题号说明文字与装订边；确保每个框之间不重叠、不遗漏。\n' +
  '- 【大题只框一个框】：「阅读理解/材料/解答/论述/作文」等大题，整个大题（含材料与全部小题）只框成一个框，不要为小题单独框选。\n' +
  '- 【选择题等每题一框】：选择题、判断题、填空题等小题型，每道题单独一个框。\n' +
  '- 【题目内嵌图片】：页面中所有的示意图/图表/图形/几何图（非题目文字）统一放入顶层的 "pageFigures" 数组，每项为 {"bbox":[x0,y0,x1,y1],"label":"可选说明"}；' +
  '严禁把图片放进任何 boxes 元素内部（boxes 元素不要出现 figures 字段），图片只是页面级区域、不与具体题目绑定，由人工在审阅时再指派给题目；与题目无关的装饰插图可忽略。\n' +
  '示例：{"paperName":"2023年高考数学全国卷I","boxes":[{"bbox":[0.05,0.08,0.95,0.20],"type":"SINGLE_CHOICE","confidence":0.95},{"bbox":[0.05,0.22,0.95,0.60],"type":"READING_COMPREHENSION","confidence":0.9}],"pageFigures":[{"bbox":[0.5,0.30,0.9,0.45],"label":"几何图形"}]}';

/** 供前端调试面板展示「实际发送给 AI 的提示词」 */
export function buildDetectPrompt(): string {
  return `${DETECT_SYSTEM_PROMPT}\n\n${DETECT_USER_PROMPT}`;
}

/** 图片尺寸（用于把模型可能返回的像素坐标换算为归一化坐标） */
interface ImageDims {
  width: number;
  height: number;
}

/**
 * 真实视觉模型提供方（兼容 OpenAI /v1/chat/completions 视觉接口）。
 * 通过 settings 的 `vlm` 组注入 apiKey / baseUrl / model 启用。
 * 生产环境可替换 baseUrl 为任意兼容服务的地址（如阿里云 DashScope 视觉模型）。
 */
export class RealVlmProvider implements VLMProvider {
  readonly name = 'real';
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(private readonly config: RealVlmConfig) {
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.model = config.model || 'gpt-4o';
  }

  // ---------------- 版面检测：输出题目框 + 试卷名 ----------------
  async detect(input: DetectInput): Promise<DetectResult> {
    if (!this.config.apiKey) throw new BadRequestException('未配置 VLM API Key');

    const imageUrl = await this.toDataUrl(input);
    if (!imageUrl) throw new BadRequestException('缺少识别图像');

    const dims = await this.imageSize(input);

    const text = await this.chat(imageUrl, DETECT_SYSTEM_PROMPT, DETECT_USER_PROMPT);
    const parsed = parseDetectText(text);

    const boxes: DetectedBox[] = (parsed.boxes || [])
      .map((b) => this.normalizeBox(b, dims))
      .filter((b): b is DetectedBox => !!b);

    // 页面级图片：以模型顶层 pageFigures 为准；个别模型仍把图塞进 box.figures 时一并收拢到页面级，
    // 保证图片始终「独立于题目」，不与任何题目绑定。
    const pageFigures = [
      ...this.normalizeFigures(parsed.pageFigures, dims),
      ...(parsed.boxes || []).flatMap((b: any) => this.normalizeFigures(b?.figures, dims)),
    ];

    return { model: this.model, paperName: parsed.paperName, boxes, pageFigures, raw: text };
  }

  // ---------------- 题目内容识别（支持 bbox 区域提示） ----------------
  async recognize(input: RecognizeInput): Promise<RecognizeResult> {
    if (!this.config.apiKey) throw new BadRequestException('未配置 VLM API Key');

    const imageUrl = await this.toDataUrl(input);
    if (!imageUrl) throw new BadRequestException('缺少识别图像');

    const bboxHint = input.bbox
      ? `\n请只读取图片中由归一化坐标 bbox=[${input.bbox.map((n) => n.toFixed(3)).join(', ')}] 圈出的题目区域（[x0,y0] 左上，[x1,y1] 右下，坐标范围 0-1）。`
      : '';

    const subjectHint = input.subjectNames?.length
      ? `\nsubject 字段为题目所属学科，必须从以下学科名称中选一个最匹配的（根据题目内容判断：含公式/函数/几何→数学，含文言文/诗词/现代文→语文，含英文→英语，含化学式→化学等；不要留空）：[${input.subjectNames.join('、')}]。`
      : '\nsubject 字段为题目所属学科名称（根据题目内容判断，如数学、物理、英语），不要留空。';

    // 题型约束：人工已指定则按该题型结构提取；首次识别（未指定）让模型自行判断
    const typeHint = input.type
      ? `\n这是一道「${TYPE_CN[input.type] ?? input.type}」题，请严格按该题型的 content 结构输出，type 字段保持 ${input.type} 不变。`
      : '\n题型未预先指定：请根据题目内容自行判断 type（SINGLE_CHOICE/MULTIPLE_CHOICE/TRUE_FALSE/FILL_BLANK/SHORT_ANSWER/ESSAY/MATERIAL/READING_COMPREHENSION），并严格按该题型的 content 结构输出。';

    const prompt =
      input.prompt ||
      '请识别图片中的题目，只输出一个 JSON 对象，形如 {"items":[...]}，不要任何解释或 markdown 代码块。\n' +
        '每题包含字段：type、stem、content、analysis、difficulty、subject、suggestedKnowledgePoints、suggestedTags。\n' +
        'type 从 SINGLE_CHOICE/MULTIPLE_CHOICE/TRUE_FALSE/FILL_BLANK/SHORT_ANSWER/ESSAY/MATERIAL/READING_COMPREHENSION 中选。\n' +
        'stem 与 analysis 可包含 LaTeX（行内用 $...$，独立公式用 $$...$$）。\n' +
        '【重要】题干(stem)中不要包含分值/得分信息（如"（10分）"）；若图上有分值，请单独输出到 content.score（该题分值，数字）或 content.subQuestions[].score（各小题分值，数字）。\n' +
        'content 必须按题型使用以下结构，切勿只给题干：\n' +
        '- SINGLE_CHOICE/MULTIPLE_CHOICE：{"options":[{"key":"A","text":"选项内容(可含LaTeX)","correct":false}, ...], "answer":"A"或"AB"}\n' +
        '- TRUE_FALSE：{"answer":"T" 或 "F"}（T=正确，F=错误）\n' +
        '- FILL_BLANK（填空题：题干里有横线 ___、下划线或括号（ ）等空位，只需填词/数字/公式）→ {"blanks":["第一空答案","第二空答案",...]}\n' +
        '- SHORT_ANSWER/ESSAY（简答/论述：需要用文字作答）：若大题含多个小问（如 (1)(2)(3)），输出 {"subQuestions":[{"type":"小题题型(SINGLE_CHOICE/SHORT_ANSWER等，按小题内容判断)","stem":"小题干","score":分值}]}（只识别每个小问的题干、题型与分值，不识别答案）；若只有一道题，输出 {"rubric":"评分要点/参考答案"}\n' +
        '- MATERIAL：{"subQuestions":[{"stem":"小题题干","answer":"参考答案","score":分值}]}\n' +
        '- READING_COMPREHENSION（阅读理解大题）：{"passage":"阅读材料全文","subQuestions":[{"type":"SINGLE_CHOICE 或 MULTIPLE_CHOICE 或 SHORT_ANSWER","stem":"小题题干","options":[{"key":"A","text":"选项内容(可含LaTeX)"}]}]}。stem 为这道大题的开头引语（如「阅读下面短文，回答问题」，若无则留空字符串）；每个小题的 type 为该小题题型（选择类小题输出 options，简答类小题省略 options）；不要输出 answer、correct、analysis。\n' +
        'difficulty 为 1-5 的整数。' +
        typeHint +
        subjectHint +
        'suggestedKnowledgePoints 与 suggestedTags 为字符串数组。\n' +
        bboxHint;

    const text = await this.chat(imageUrl, undefined, prompt);
    let parsed: any;
    try {
      parsed = JSON.parse(stripFences(text));
    } catch {
      parsed = { items: [] };
    }
    const items: any[] = Array.isArray(parsed) ? parsed : parsed.items || [];
    return { model: this.model, items: this.normalizeItems(items) };
  }

  // ---------------- 内部工具 ----------------
  private async chat(imageUrl: string, systemPrompt?: string, userPrompt?: string): Promise<string> {
    const messages: any[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userPrompt || DETECT_USER_PROMPT },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    });

    const body = {
      model: this.model,
      messages,
      response_format: { type: 'json_object' },
    };

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      const lowered = errText.toLowerCase();
      // 常见误配置：模型名不存在 / 未开通 / MaaS 部署名不匹配
      if (resp.status === 404 || lowered.includes('model_not_found') || lowered.includes('model not exist')) {
        throw new BadRequestException(
          `VLM 模型名无效或该模型未在控制台开通。当前 model="${this.model}"、baseUrl="${this.baseUrl}"。` +
            `若用阿里云 DashScope 公开端点，视觉(框选/识题)模型请填 qwen-vl-max-latest 或 qwen-vl-plus；` +
            `若用 MaaS 私有端点，model 必须精确等于你在百炼控制台部署时起的部署名，且该部署必须是视觉模型(VL)。`,
        );
      }
      if (resp.status === 401) {
        throw new BadRequestException(`VLM 鉴权失败(401)：请检查系统设置中视觉模型的 API Key 是否正确。`);
      }
      throw new BadRequestException(`VLM 调用失败: ${resp.status} ${errText.slice(0, 200)}`);
    }
    const data: any = await resp.json();
    return data?.choices?.[0]?.message?.content || '{}';
  }

  private async toDataUrl(input: DetectInput | RecognizeInput): Promise<string | null> {
    const buf = await this.readBuffer(input);
    if (!buf) return null;
    const ext = input.imagePath ? path.extname(input.imagePath).toLowerCase() : '';
    const mime =
      ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : input.mimeType || 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  }

  private async readBuffer(input: DetectInput | RecognizeInput): Promise<Buffer | null> {
    if (input.buffer) return input.buffer;
    if (input.imagePath) {
      const fs = await import('fs/promises');
      return fs.readFile(input.imagePath);
    }
    return null;
  }

  /** 从图片 buffer 解析尺寸（PNG/JPEG），用于像素坐标换算；无法解析时返回 undefined */
  private async imageSize(input: DetectInput | RecognizeInput): Promise<ImageDims | undefined> {
    const buf = await this.readBuffer(input);
    if (!buf) return undefined;
    try {
      return imageSizeFromBuffer(buf);
    } catch {
      return undefined;
    }
  }

  private normalizeBox(b: any, dims?: ImageDims): DetectedBox | null {
    const bbox = this.toBBox(b?.bbox ?? b?.bbox_2d ?? b?.box, dims);
    if (!bbox) return null;
    // 图片不再挂在题目框上（统一收拢到页面级 pageFigures）
    return {
      bbox,
      type: b?.type as QuestionType | undefined,
      confidence: typeof b?.confidence === 'number' ? b.confidence : undefined,
    };
  }

  /** 图片区域数组归一化：与题框同坐标系，逐条转换，非法项丢弃 */
  private normalizeFigures(raw: any, dims?: ImageDims): Array<{ bbox: BBox; label?: string }> {
    if (!Array.isArray(raw)) return [];
    const out: Array<{ bbox: BBox; label?: string }> = [];
    for (const f of raw) {
      const fb = this.toBBox(f?.bbox ?? f?.bbox_2d ?? f?.box, dims);
      if (fb) out.push({ bbox: fb, label: typeof f?.label === 'string' ? f.label : undefined });
    }
    return out;
  }

  /**
   * 解析并归一化单个框坐标。
   * - 支持别名：bbox / bbox_2d / box。
   * - 任一值 > 1.5 视为像素坐标，按图片尺寸换算为归一化（x 用宽、y 用高）；否则按 0-1 钳制。
   * - 保证 x0<x1、y0<y1（必要时交换）。
   */
  private toBBox(raw: any, dims?: ImageDims): BBox | null {
    if (!Array.isArray(raw) || raw.length !== 4) return null;
    const nums = raw.map((n) => Number(n));
    if (nums.some((n) => Number.isNaN(n))) return null;

    let [x0, y0, x1, y1] = nums;
    const w = dims?.width || 0;
    const h = dims?.height || 0;
    const pixelMode = nums.some((n) => n > 1.5) && w > 0 && h > 0;
    if (pixelMode) {
      x0 = x0 / w;
      y0 = y0 / h;
      x1 = x1 / w;
      y1 = y1 / h;
    }
    // 钳制到 [0,1]，并交换保证左上<右下
    const c = (v: number) => Math.min(1, Math.max(0, v));
    const left = c(Math.min(x0, x1));
    const right = c(Math.max(x0, x1));
    const top = c(Math.min(y0, y1));
    const bottom = c(Math.max(y0, y1));
    // 退化为零尺寸（如整组被钳成同一点）时仍返回，由上层过滤
    return [left, top, right, bottom];
  }

  private normalizeItems(items: any[]): DetectedQuestion[] {
    return items.map((it) => {
      // difficulty 强转：模型偶发返回字符串（如 "3"）或越界值，统一归一到 1-5 整数
      const rawDiff = Number(it.difficulty);
      const difficulty =
        Number.isFinite(rawDiff) && rawDiff >= 1 && rawDiff <= 5 ? Math.round(rawDiff) : undefined;
      return {
        type: it.type as QuestionType | undefined,
        stem: it.stem,
        content: it.content,
        analysis: it.analysis,
        difficulty,
        subject: typeof it.subject === 'string' ? it.subject.trim() : undefined,
        bbox: this.toBBox(it.bbox) ?? undefined,
        confidence: typeof it.confidence === 'number' ? it.confidence : undefined,
        suggestedKnowledgePoints: Array.isArray(it.suggestedKnowledgePoints) ? it.suggestedKnowledgePoints : [],
        suggestedTags: Array.isArray(it.suggestedTags) ? it.suggestedTags : [],
      };
    });
  }
}

/**
 * 解析版面检测模型的回复文本：
 * 1. 剥离 ```json / ``` 围栏；
 * 2. 若直接 JSON.parse 失败，截取首个 {...} 子串再解析；
 * 3. 兼容 boxes / questions / items 数组别名，以及 paperName / paper_name / title 字段别名；
 * 4. 兼容页面级图片数组别名 pageFigures / page_figures / figures。
 */
export function parseDetectText(text: string): {
  paperName?: string;
  boxes: any[];
  pageFigures: any[];
} {
  const cleaned = stripFences(text);
  let parsed: any = {};
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        parsed = {};
      }
    }
  }
  if (typeof parsed !== 'object' || parsed === null) parsed = {};

  const boxesRaw: any[] =
    parsed.boxes ?? parsed.questions ?? parsed.items ?? [];
  const paperName: string | undefined =
    parsed.paperName ?? parsed.paper_name ?? parsed.title ?? undefined;
  const figuresRaw: any[] = parsed.pageFigures ?? parsed.page_figures ?? parsed.figures ?? [];
  return {
    paperName,
    boxes: Array.isArray(boxesRaw) ? boxesRaw : [],
    pageFigures: Array.isArray(figuresRaw) ? figuresRaw : [],
  };
}

/** 剥离 markdown 代码围栏（```json ... ``` 或 ``` ... ```） */
export function stripFences(text: string): string {
  if (typeof text !== 'string') return '';
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  return text.trim();
}

/** 从图片 buffer 解析宽高（PNG / JPEG），解析失败抛错 */
export function imageSizeFromBuffer(buf: Buffer): ImageDims {
  if (buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG') {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1];
      // SOF0..SOF15 中除 C4/C8/CC 外都含尺寸
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = buf.readUInt16BE(i + 5);
        const width = buf.readUInt16BE(i + 7);
        return { width, height };
      }
      const len = buf.readUInt16BE(i + 2);
      i += 2 + len;
    }
  }
  throw new Error('unsupported image format for dimension probing');
}

