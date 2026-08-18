import { IsString, IsOptional, IsEmail, IsIn, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(6, { message: '密码至少 6 位' })
  password?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';

  @IsOptional()
  roleCodes?: string[];
}
