import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from '../../common/types/request';

export interface JwtPayload {
  sub: string;
  username: string;
  name?: string;
  roles: string[];
  permissions: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(cfg: ConfigService) {
    const secret = cfg.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET 未配置');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload?.sub) throw new UnauthorizedException('无效的令牌');
    return {
      id: payload.sub,
      username: payload.username,
      name: payload.name,
      roles: payload.roles ?? [],
      permissions: payload.permissions ?? [],
    };
  }
}
