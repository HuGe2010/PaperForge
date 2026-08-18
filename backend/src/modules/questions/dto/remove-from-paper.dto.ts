import { IsArray, IsString } from 'class-validator';

/** 试卷侧边栏「从小卷移除题目」：把题目的 sourcePapers 剔除指定试卷名（不删除题目） */
export class RemoveFromPaperDto {
  @IsString()
  paperName: string;

  @IsArray()
  questionIds: string[];
}
