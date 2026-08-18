import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { JwtPayload } from './jwt.strategy';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import * as crypto from 'crypto';

export interface TokenUser {
  id: string;
  username: string;
  name?: string;
  roles: string[];
  permissions: string[];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.users.validateCredentials(dto.username, dto.password);
    if (!user) throw new UnauthorizedException('用户名或密码错误');
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('账号已被禁用，请联系管理员');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueTokens(user);
  }

  async refresh(dto: RefreshDto) {
    const record = await this.prisma.refreshToken.findUnique({ where: { token: dto.refreshToken } });
    if (!record || record.revoked || record.expiresAt < new Date()) {
      throw new UnauthorizedException('刷新令牌无效或已过期');
    }
    const user = await this.users.findByIdWithRoles(record.userId);
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('用户不可用');
    // 轮换：撤销旧刷新令牌，签发新令牌对
    await this.prisma.refreshToken.update({ where: { id: record.id }, data: { revoked: true } });
    return this.issueTokens(user);
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { token: refreshToken },
      data: { revoked: true },
    });
  }

  async logoutAll(userId: string) {
    await this.prisma.refreshToken.updateMany({ where: { userId }, data: { revoked: true } });
  }

  private async issueTokens(user: TokenUser) {
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      name: user.name,
      roles: user.roles,
      permissions: user.permissions,
    };
    const accessToken = this.jwt.sign(payload);
    const refreshTtl = parseInt(this.cfg.get<string>('JWT_REFRESH_TTL', '604800'), 10);
    const jti = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + refreshTtl * 1000);
    await this.prisma.refreshToken.create({ data: { userId: user.id, token: jti, expiresAt } });
    return {
      accessToken,
      refreshToken: jti,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        roles: user.roles,
        permissions: user.permissions,
      },
    };
  }
}
