import {
  IsOptional,
  IsString,
  IsInt,
  IsArray,
  IsEnum,
  IsObject,
  Min,
  Max,
  IsIn,
} from 'class-validator';
import { QuestionType, SourceType, QuestionStatus } from '@prisma/client';

export class UpdateQuestionDto {
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

  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  knowledgePointIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];

  @IsOptional()
  @IsEnum(SourceType)
  sourceType?: SourceType;

  @IsOptional()
  @IsEnum(QuestionStatus)
  status?: QuestionStatus;

  /** 来源试卷名（详情页可编辑；不传则保持原值） */
  @IsOptional()
  @IsString()
  sourcePaperName?: string;

  /** 来源试卷列表（去重合并时追加；不传则保持原值） */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourcePapers?: string[];

  /** 归属作业本（独立实体）；不传则保持原值 */
  @IsOptional()
  @IsString()
  workbookId?: string;

  /** 作业本层级路径（作业本名 → 章节 → ...）；不传则保持原值 */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourcePath?: string[];
}
