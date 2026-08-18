import {
  IsString,
  IsOptional,
  IsInt,
  IsArray,
  IsEnum,
  IsObject,
  Min,
  Max,
  IsIn,
} from 'class-validator';
import { QuestionType, SourceType, QuestionStatus } from '@prisma/client';

export class CreateQuestionDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsEnum(QuestionType)
  type: QuestionType;

  @IsString()
  stem: string;

  @IsObject()
  content: Record<string, any>;

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

  @IsOptional()
  @IsString()
  sourcePaperName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourcePapers?: string[];

  @IsOptional()
  @IsInt()
  number?: number;

  @IsOptional()
  @IsInt()
  groupIndex?: number;

  @IsOptional()
  @IsString()
  groupTitle?: string;

  @IsOptional()
  @IsString()
  sourceFileId?: string;

  @IsOptional()
  @IsString()
  workbookId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourcePath?: string[];

  @IsOptional()
  @IsString()
  sourceImagePath?: string;

  @IsOptional()
  @IsString()
  solution?: string;
}
