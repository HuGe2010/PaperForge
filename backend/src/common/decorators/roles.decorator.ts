import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
/** 要求用户拥有任一角色：@Roles('ADMIN', 'TEACHER') */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
