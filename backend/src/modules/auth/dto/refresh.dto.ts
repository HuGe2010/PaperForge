import { IsString, IsNotEmpty } from 'class-validator';

export class RefreshDto {
  @IsString()
  @IsNotEmpty({ message: '刷新令牌不能为空' })
  refreshToken: string;
}
