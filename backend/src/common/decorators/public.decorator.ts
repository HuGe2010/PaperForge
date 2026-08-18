import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** 标记路由为公开（跳过 JWT 鉴权）。用于 <img src> 直接访问的资源（如题图 crops）。 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
