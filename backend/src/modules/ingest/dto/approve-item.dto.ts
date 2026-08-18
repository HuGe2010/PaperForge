import { IsOptional, IsArray, IsString } from 'class-validator';

/** 批准入题时携带的归属选择（学科/标签/知识点在审阅时确定，不持久化在 OcrItem 上） */
export class ApproveItemDto {
  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  knowledgePointIds?: string[];

  /** 该题所属试卷（人工标注，覆盖识别值） */
  @IsOptional()
  @IsString()
  paperName?: string;
}
