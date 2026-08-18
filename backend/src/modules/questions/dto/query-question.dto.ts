import { IsOptional, IsString, IsInt, IsEnum, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { QuestionType, SourceType, QuestionStatus } from '@prisma/client';

export class QueryQuestionDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  subjectId?: string;

  /** 学科子孙过滤：逗号分隔的学科 id 列表，命中集合内任一学科即返回（用于点击父学科筛出全部子学科题目）。
   *  用逗号分隔字符串而非数组，规避 class-transformer 在 query 数组上的转换丢失问题。 */
  @IsOptional()
  @IsString()
  subjectIds?: string;

  @IsOptional()
  @IsEnum(QuestionType)
  type?: QuestionType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  difficulty?: number;

  @IsOptional()
  @IsEnum(QuestionStatus)
  status?: QuestionStatus;

  @IsOptional()
  @IsEnum(SourceType)
  sourceType?: SourceType;

  @IsOptional()
  @IsString()
  tagId?: string;

  @IsOptional()
  @IsString()
  knowledgePointId?: string;

  @IsOptional()
  @IsString()
  sourcePaper?: string;

  @IsOptional()
  @IsString()
  sourceFileId?: string;

  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';
}
