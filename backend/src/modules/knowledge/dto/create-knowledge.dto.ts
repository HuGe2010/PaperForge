import { IsString, IsOptional, IsInt, Min } from 'class-validator';

export class CreateKnowledgePointDto {
  @IsString()
  subjectId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class UpdateKnowledgePointDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
