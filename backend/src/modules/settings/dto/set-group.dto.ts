import { IsArray, IsString, ValidateNested, IsOptional, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class SettingItemDto {
  @IsString()
  key: string;

  @IsOptional()
  value: string | null = null;

  @IsOptional()
  @IsBoolean()
  isSecret?: boolean;
}

export class SetGroupDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettingItemDto)
  items: SettingItemDto[];
}
