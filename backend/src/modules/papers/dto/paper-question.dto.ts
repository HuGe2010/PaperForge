import { IsString, IsArray, IsNumber, IsInt, Min, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class AddQuestionDto {
  @IsString()
  questionId: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  score?: number;
}

export class BatchAddQuestionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddQuestionDto)
  items: AddQuestionDto[];
}

export class ReorderDto {
  @IsArray()
  @IsString({ each: true })
  orderedIds: string[];
}

export class SetScoreDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  score: number;
}
