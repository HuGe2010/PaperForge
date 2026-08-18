import { IsArray } from 'class-validator';

/** 题内图片原子更新：整体替换 content.images（服务端校验格式并去重） */
export class SetQuestionImagesDto {
  @IsArray()
  images: Array<{ cropId: string; label?: string }>;
}
