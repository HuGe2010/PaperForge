import { QuestionType } from '@prisma/client';

/** 归一化包围盒 [x0, y0, x1, y1]，坐标相对原图（0-1） */
export type BBox = [number, number, number, number];

/** VLM 识别出的单道候选题目 */
export interface DetectedQuestion {
  type?: QuestionType;
  stem?: string;
  content?: Record<string, any>;
  analysis?: string;
  difficulty?: number;
  /** AI 识别的学科名称（自由文本，由后端映射到真实 subjectId） */
  subject?: string;
  bbox?: BBox;
  confidence?: number;
  /** AI 建议的知识点名称（待确认，避免污染知识点树） */
  suggestedKnowledgePoints?: string[];
  /** AI 建议的标签名 */
  suggestedTags?: string[];
}

/** 识别输入：图像路径或内存 buffer 二选一；bbox 为可选的区域提示（仅读取该区域） */
export interface RecognizeInput {
  imagePath?: string;
  buffer?: Buffer;
  mimeType?: string;
  subjectId?: string;
  /** 可选：传入系统已有学科名称列表，约束模型只从该列表选择 subject（提升映射命中率） */
  subjectNames?: string[];
  /** 用户指定的题型：识别时作为硬约束，模型只按该题型结构提取内容，不自行判断题型 */
  type?: QuestionType;
  prompt?: string;
  /** 归一化包围盒 [x0,y0,x1,y1]，传入后模型只读取该区域 */
  bbox?: BBox;
}

export interface RecognizeResult {
  model: string;
  items: DetectedQuestion[];
}

/** 版面检测出的单个题目框 */
export interface DetectedBox {
  bbox: BBox;
  type?: QuestionType;
  confidence?: number;
  /** 题号（如 1、2），标题框为 null */
  number?: number | null;
  /** 大题标题文本（如「一、选择题」），标题框有值 */
  title?: string | null;
  /** 题内图片区域 [{bbox:[x0,y0,x1,y1], label?}]（OCR 识别的题目附图） */
  figures?: Array<{ bbox: BBox; label?: string }>;
}

/** 版面检测输入 */
export interface DetectInput {
  imagePath?: string;
  buffer?: Buffer;
  mimeType?: string;
  prompt?: string;
}

/** 版面检测输出：整页的题目框集合 + 建议试卷名 */
export interface DetectResult {
  model: string;
  paperName?: string;
  boxes: DetectedBox[];
  /**
   * 页面级图片区域（与题目框解耦，不绑定任何题）：
   * 落库到 IngestPage.figures，审阅台在「采用已框题图」池中按需采用到任意题/小题。
   */
  pageFigures?: Array<{ bbox: BBox; label?: string }>;
  /** AI 的原始回复文本（用于前端调试展示，不落库） */
  raw?: string;
}

/** VLM 提供方抽象，便于在 Mock 与真实视觉模型之间切换 */
export interface VLMProvider {
  readonly name: string;
  /** 版面检测：输出每道题的包围框与试卷标题 */
  detect(input: DetectInput): Promise<DetectResult>;
  /** 识别单张（或单区域）题目内容 */
  recognize(input: RecognizeInput): Promise<RecognizeResult>;
}
