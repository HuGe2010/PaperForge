import { IsString, IsOptional } from 'class-validator';

export class CreateTagDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  group?: string;
}

export class UpdateTagDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  group?: string;
}
