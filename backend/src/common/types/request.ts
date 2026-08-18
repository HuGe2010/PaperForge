import { Request } from 'express';

/** JWT 载荷 + 请求上下文中的当前用户 */
export interface AuthenticatedUser {
  id: string;
  username: string;
  name?: string;
  /** 角色 code 列表，如 ['ADMIN'] */
  roles: string[];
  /** 扁平化权限码列表，如 ['question:create'] */
  permissions: string[];
}

/**
 * 携带已认证用户的请求类型。
 * 注意：不全局覆盖 Express.Request.user（会与 @types/passport 冲突），
 * 而是在守卫/装饰器里将 req.user 断言为该类型。
 */
export type RequestWithUser = Request & { user: AuthenticatedUser };

export type { Request };
