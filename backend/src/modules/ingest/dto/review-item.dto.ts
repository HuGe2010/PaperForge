import { IsOptional, IsString, IsObject, IsInt, IsArray, Min, Max, IsEnum, IsNumber } from 'class-validator';
import { QuestionType, OcrItemStatus } from '@prisma/client';

/** 审阅台编辑单道候选题目（可改题干/题型/难度/解析/框选区域/所属试卷等） */
export class ReviewItemDto {
  @IsOptional()
  @IsEnum(QuestionType)
  type?: QuestionType;

  @IsOptional()
  @IsString()
  stem?: string;

  @IsOptional()
  @IsObject()
  content?: Record<string, any>;

  @IsOptional()
  @IsString()
  analysis?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  /** 归一化包围盒 [x0,y0,x1,y1]（0-1） */
  @IsOptional()
  @IsArray()
  bbox?: number[];

  /** 该题所属试卷（覆盖页面识别值） */
  @IsOptional()
  @IsString()
  paperName?: string;

  /** 题内图片区域 [{bbox:[x0,y0,x1,y1], cropId?, label?}]（OCR 识别的题目附图，人工可改） */
  @IsOptional()
  @IsArray()
  figures?: Array<{ bbox: number[]; cropId?: string; label?: string }>;

  /** 大题分组（审阅台右侧题号面板：拖拽跨组即保存） */
  @IsOptional()
  @IsInt()
  groupIndex?: number | null;

  /** 大题标题（如「一、选择题」，可点击编辑） */
  @IsOptional()
  @IsString()
  groupTitle?: string | null;

  /** 题号（右侧面板排序用，可人工调整） */
  @IsOptional()
  @IsInt()
  number?: number | null;

  /** 学科（AI 识别或人工标注），对应 Subject.id */
  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsEnum(OcrItemStatus)
  status?: OcrItemStatus;
}
