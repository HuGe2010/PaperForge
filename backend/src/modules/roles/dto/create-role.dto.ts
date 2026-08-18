import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty({ message: '角色编码不能为空' })
  code: string;

  @IsString()
  @IsNotEmpty({ message: '角色名称不能为空' })
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  permissionCodes?: string[];
}
