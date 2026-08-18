import { IsArray, IsString } from 'class-validator';

export class SetPermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissionCodes: string[];
}
