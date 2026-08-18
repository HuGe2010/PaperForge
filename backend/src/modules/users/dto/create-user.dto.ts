import { IsString, IsNotEmpty, IsOptional, IsEmail, IsIn, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty({ message: '用户名不能为空' })
  username: string;

  @IsString()
  @IsNotEmpty({ message: '姓名不能为空' })
  name: string;

  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;

  @IsString()
  @MinLength(6, { message: '密码至少 6 位' })
  password: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';

  /** 角色 code 列表，如 ['TEACHER'] */
  @IsOptional()
  roleCodes?: string[];
}
