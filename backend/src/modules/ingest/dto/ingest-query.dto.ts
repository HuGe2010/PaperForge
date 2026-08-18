import { Type } from 'class-transformer';
import { IsOptional, IsEnum, IsInt, Min } from 'class-validator';
import { IngestJobStatus } from '@prisma/client';

export class IngestQueryDto {
  @IsOptional()
  @IsEnum(IngestJobStatus)
  status?: IngestJobStatus;

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
}
