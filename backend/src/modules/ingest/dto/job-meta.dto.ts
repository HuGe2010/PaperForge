import { IsOptional, IsString, IsIn } from 'class-validator';

/** 审阅台统一操作区：批量更新录入任务的类型/名称/学科，以及（选作业本时）指向已有作业本 */
export class JobMetaDto {
  @IsOptional()
  @IsIn(['PAPER', 'WORKBOOK'])
  sourceType?: 'PAPER' | 'WORKBOOK';

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  subjectId?: string;

  /** 选「是作业本」时指向已有作业本（作业本实体独立，章节树在作业本视图内管理） */
  @IsOptional()
  @IsString()
  workbookId?: string;

  /** 选「是作业本」时指向的具体章节（审批时按章节全路径写题目的 sourcePath；为空=作业本根） */
  @IsOptional()
  @IsString()
  workbookSectionId?: string | null;
}
