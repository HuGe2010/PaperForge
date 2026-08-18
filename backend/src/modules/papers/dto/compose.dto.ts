import { IsOptional, IsString, IsArray, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { QuestionType } from '@prisma/client';

/** 智能抽题条件：按学科 / 题型分布 / 难度区间 / 数量自动选题 */
export class ComposeDto {
  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(QuestionType, { each: true })
  types?: QuestionType[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  difficultyMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  difficultyMax?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  count?: number = 10;
}
