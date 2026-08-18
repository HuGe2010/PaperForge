import { IsArray, IsString, ArrayNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class BatchDeleteQuestionsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Type(() => String)
  ids: string[];
}
