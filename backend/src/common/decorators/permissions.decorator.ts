import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
/** 要求用户拥有全部权限：@RequirePermissions('question:create') */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
