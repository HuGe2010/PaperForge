export interface UserProfile {
  id: string;
  username: string;
  name?: string;
  email?: string;
  status: string;
  roles: string[];
  permissions: string[];
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: UserProfile;
}

export interface ApiList<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ----------------------- 题库相关类型 -----------------------
export type QuestionType =
  | 'SINGLE_CHOICE'
  | 'MULTIPLE_CHOICE'
  | 'TRUE_FALSE'
  | 'FILL_BLANK'
  | 'SHORT_ANSWER'
  | 'ESSAY'
  | 'MATERIAL'
  | 'READING_COMPREHENSION';

export type SourceType = 'MANUAL' | 'OCR' | 'IMPORT';
export type QuestionStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  SINGLE_CHOICE: '单选题',
  MULTIPLE_CHOICE: '多选题',
  TRUE_FALSE: '判断题',
  FILL_BLANK: '填空题',
  SHORT_ANSWER: '简答题',
  ESSAY: '论述题',
  MATERIAL: '材料题',
  READING_COMPREHENSION: '阅读理解',
};

/** 题型下拉选项（各处题型选择统一用这一份，避免重复 Object.entries(...).map） */
export const QUESTION_TYPE_OPTIONS = Object.entries(QUESTION_TYPE_LABEL).map(([value, label]) => ({
  value: value as QuestionType,
  label,
}));

/** 学科树选择器 props（学科默认 node 主键为 id） */
export const SUBJECT_TREE_PROPS = { value: 'id', label: 'name', children: 'children' } as const;

/** 知识点树选择器 props */
export const KP_TREE_PROPS = { label: 'name', children: 'children' } as const;

/** 选择题选项 */
export interface QuestionOption {
  key: string; // A/B/C/D
  text: string;
  correct?: boolean;
}

/** 试题 content（题型相关的 JSONB） */
export interface QuestionContent {
  options?: QuestionOption[]; // 选择题
  answer?: string; // 选择/判断/填空答案
  blanks?: string[]; // 填空每空答案
  rubric?: string; // 简答/论述评分要点
  passage?: string; // 阅读理解大题的阅读材料（AI 识别保存，审阅台不展示）
  score?: number; // 大题分值（识别或人工填写，AI 解题时按分值给得分点）
  images?: Array<{ cropId?: string; label?: string; bbox?: number[] }>; // 题内图片（OCR 识别题图后入库）
  subQuestions?: Array<{
    type?: QuestionType | '' | null; // 小题自身题型（选择/简答等，编辑时可为空字符串）
    stem: string;
    options?: QuestionOption[]; // 选择类小题
    answer?: string;
    analysis?: string;
    score?: number;
    images?: { cropId: string; label?: string }[]; // 小题题干题图
  }>; // 材料题/阅读理解小题
  [k: string]: any;
}

export interface Subject {
  id: string;
  name: string;
  code: string | null;
  parentId: string | null;
  description: string | null;
  order: number;
  knowledgePoints?: KnowledgePoint[];
  children?: Subject[];
}

export interface Tag {
  id: string;
  name: string;
  group: string | null;
  _count?: { questions: number };
}

export interface KnowledgePoint {
  id: string;
  subjectId: string;
  name: string;
  parentId: string | null;
  path: string;
  level: number;
  order: number;
  questionCount: number;
  children?: KnowledgePoint[];
}

export interface QuestionListItem {
  id: string;
  type: QuestionType;
  stem: string;
  difficulty: number;
  status: QuestionStatus;
  sourceType: SourceType;
  usageCount: number;
  createdAt: string;
  sourcePaperName?: string | null;
  sourcePapers?: string[];
  /** 归属作业本：实体 id（独立实体，章节树在作业本视图内管理） */
  workbookId?: string | null;
  /** 章节路径快照：['作业本名', '一级章节', '二级章节', ...]，长度 1 表示作业本根 */
  sourcePath?: string[] | null;
  subject?: { id: string; name: string } | null;
  tags: { id: string; name: string; group: string | null }[];
  knowledgePoints: { id: string; name: string }[];
}

export interface QuestionDetail extends QuestionListItem {
  content: QuestionContent;
  analysis: string | null;
  solution?: string | null;
  llmModel?: string | null;
  sourceImagePath?: string | null;
  createdBy?: { id: string; name: string; username: string } | null;
  /** 该题被哪些组卷 Paper 引用 */
  papers?: { id: string; title: string }[];
}

export interface QuestionQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  subjectId?: string;
  /** 学科子孙过滤：逗号分隔的学科 id（自身 + 所有子孙），后端按 subjectId in [...] 匹配 */
  subjectIds?: string;
  type?: QuestionType;
  difficulty?: number;
  status?: QuestionStatus;
  sourceType?: SourceType;
  tagId?: string;
  knowledgePointId?: string;
  sourcePaper?: string;
  sourceFileId?: string;
  sortBy?: string;
  order?: 'asc' | 'desc';
}

// ----------------------- OCR 录题流水线类型 -----------------------
export type IngestJobStatus =
  | 'UPLOADED'
  | 'PREPROCESSING'
  | 'RECOGNIZING'
  | 'SEGMENTING'
  | 'TAGGING'
  | 'REVIEWING'
  | 'DONE'
  | 'FAILED';

export type OcrItemStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'MERGED'
  | 'DISCARDED'
  | 'DETECTED';

export const INGEST_JOB_STATUS_LABEL: Record<IngestJobStatus, string> = {
  UPLOADED: '已上传',
  PREPROCESSING: '预处理中',
  RECOGNIZING: '识别中',
  SEGMENTING: '裁题中',
  TAGGING: '打标签中',
  REVIEWING: '待审阅',
  DONE: '已完成',
  FAILED: '失败',
};

export const OCR_ITEM_STATUS_LABEL: Record<OcrItemStatus, string> = {
  DETECTED: '已框选',
  PENDING_REVIEW: '待审阅',
  APPROVED: '已入库',
  REJECTED: '已拒绝',
  MERGED: '已合并',
  DISCARDED: '已丢弃',
};

export interface OcrAttempt {
  id: string;
  ocrItemId: string;
  model: string;
  promptVersion?: string | null;
  rawOutput?: any;
  parsed?: any;
  confidence?: number | null;
  status: string;
  error?: string | null;
  createdAt: string;
}

export interface OcrItem {
  id: string;
  jobId: string;
  pageId?: string | null;
  index: number;
  status: OcrItemStatus;
  type?: QuestionType | null;
  stem?: string | null;
  content?: QuestionContent | null;
  analysis?: string | null;
  difficulty?: number | null;
  subjectId?: string | null;
  bbox?: number[] | null;
  paperName?: string | null;
  number?: number | null;
  groupIndex?: number | null;
  groupTitle?: string | null;
  sectionId?: string | null;
  isTruncated: boolean;
  confidence?: number | null;
  sourceImagePath?: string | null;
  assignedQuestionId?: string | null;
  mergedIntoId?: string | null;
  mergedFromImagePath?: string | null;
  /** 合并前自身原始框（合并主项用，回退/两图两框展示） */
  mergedFromBbox?: number[] | null;
  /** 题内图片区域（OCR 识别题图）：bbox 归一化、cropId 裁切图（识别后写入） */
  figures?: Array<{ bbox: number[]; cropId?: string; label?: string }> | null;
  createdAt: string;
  updatedAt: string;
  attempts?: OcrAttempt[];
}

export interface IngestPage {
  id: string;
  jobId: string;
  pageNumber: number;
  imagePath: string;
  width?: number | null;
  height?: number | null;
  paperName?: string | null;
  /** 页面级图片框（与题目框解耦）：bbox 归一化、cropId 裁切图 */
  figures?: Array<{ bbox: number[]; cropId?: string; label?: string }> | null;
  createdAt: string;
}

export interface IngestJob {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  status: IngestJobStatus;
  pageCount: number;
  sourceType?: 'PAPER' | 'WORKBOOK' | null;
  /** 选「是作业本」时指向已有作业本实体（章节树在作业本视图内管理） */
  workbookId?: string | null;
  /** 选「是作业本」时指向的具体章节（审批时按章节全路径写题目的 sourcePath；空=作业本根） */
  workbookSectionId?: string | null;
  subjectId?: string | null;
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
  pages?: IngestPage[];
  items?: OcrItem[];
  createdBy?: { id: string; name?: string } | null;
  _count?: { items: number };
}

// ----------------------- 作业本（独立实体）类型 -----------------------
export interface WorkbookSectionNode {
  id: string;
  workbookId: string;
  name: string;
  parentId: string | null;
  order: number;
  children?: WorkbookSectionNode[];
}

export interface Workbook {
  id: string;
  name: string;
  subjectId: string | null;
  ownerId?: string | null;
  description?: string | null;
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
  /** list 接口附加：题目数 / 章节数 */
  questionCount?: number;
  sectionCount?: number;
  subject?: { id: string; name: string } | null;
  /** get 接口附加：章节树 */
  tree?: WorkbookSectionNode[];
}

export interface KnowledgePointSuggestion {
  id: string;
  subjectId: string;
  name: string;
  parentId?: string | null;
  suggestedBy: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// ----------------------- AI 任务日志（仪表盘工作进度） -----------------------
export interface AiTaskLog {
  id: string;
  type: string; // detect(框选) / recognize(识题) / solve(解答)
  title: string;
  status: string; // RUNNING / DONE / FAILED
  percent?: number | null;
  done?: number | null;
  total?: number | null;
  message?: string | null;
  jobId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IngestListResult {
  items: IngestJob[];
  total: number;
  page: number;
  pageSize: number;
}

// ----------------------- 试卷 / 组卷类型 -----------------------
export type PaperStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export const PAPER_STATUS_LABEL: Record<PaperStatus, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  ARCHIVED: '归档',
};

export interface PaperQuestion {
  id: string;
  paperId: string;
  questionId?: string | null;
  order: number;
  score: number;
  snapshot?: any;
  createdAt: string;
  question?: {
    id: string;
    type: QuestionType;
    stem: string;
    difficulty: number;
    analysis?: string | null;
  } | null;
}

export interface Paper {
  id: string;
  title: string;
  description?: string | null;
  subjectId?: string | null;
  totalScore: number;
  estimatedMinutes?: number | null;
  status: PaperStatus;
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
  subject?: { id: string; name: string } | null;
  questions?: PaperQuestion[];
  createdBy?: { id: string; name?: string } | null;
  _count?: { questions: number };
}

export interface PaperListResult {
  items: Paper[];
  total: number;
  page: number;
  pageSize: number;
}

/** 智能抽题返回的候选题目 */
export interface ComposeCandidate {
  id: string;
  type: QuestionType;
  stem: string;
  difficulty: number;
  score: number;
}
