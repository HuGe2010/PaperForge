import { IsString, IsOptional, IsArray, ArrayNotEmpty, IsIn, MaxLength, ValidateIf } from 'class-validator';

export class CreateWorkbookDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateWorkbookDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  /** null / 空串 = 清除学科 */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '')
  @IsString()
  subjectId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class CreateSectionDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  /** null / 空串 = 建在作业本根下（顶级章节） */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '')
  @IsString()
  parentId?: string | null;
}

export class UpdateSectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  /** 传 null / 空串 = 移到顶级；不传 = 不改变层级 */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '')
  @IsString()
  parentId?: string | null;
}

export class MoveSectionDto {
  @IsIn(['up', 'down'])
  direction!: 'up' | 'down';
}

export class AssignQuestionDto {
  @IsArray()
  @ArrayNotEmpty({ message: '请选择要添加的题目' })
  @IsString({ each: true })
  questionIds!: string[];

  /** 目标章节；null / 空串 = 放到作业本根（已进作业本但未分章节） */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '')
  @IsString()
  sectionId?: string | null;
}

export class UnassignQuestionDto {
  @IsArray()
  @ArrayNotEmpty({ message: '请选择要移出的题目' })
  @IsString({ each: true })
  questionIds!: string[];
}
