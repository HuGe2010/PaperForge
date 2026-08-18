import { IsArray, IsString, IsOptional } from 'class-validator';

/** 试卷侧边栏「添加题目到试卷」：把题库中已有题目追加归属到某试卷（写 sourcePapers，不新建记录） */
export class AddToPaperDto {
  @IsString()
  paperName: string;

  @IsArray()
  @IsOptional()
  questionIds: string[];
}
