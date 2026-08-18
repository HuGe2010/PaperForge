import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

export interface UserProfile {
  id: string;
  username: string;
  name?: string;
  email?: string;
  status: string;
  roles: string[];
  permissions: string[];
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  constructor(private readonly prisma: PrismaService) {}

  private include() {
    return { roles: { include: { permissions: true } } } as const;
  }

  buildProfile(user: any): UserProfile {
    const roles = (user.roles ?? []).map((r: any) => ({
      code: r.code,
      permissions: (r.permissions ?? []).map((p: any) => p.code),
    }));
    const roleCodes = roles.map((r) => r.code);
    const permissions = Array.from(new Set(roles.flatMap((r) => r.permissions))) as string[];
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      status: user.status,
      roles: roleCodes,
      permissions,
    };
  }

  async validateCredentials(username: string, password: string): Promise<UserProfile | null> {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: this.include(),
    });
    if (!user) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return null;
    return this.buildProfile(user);
  }

  async findByIdWithRoles(id: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: this.include() });
    if (!user) throw new NotFoundException('用户不存在');
    return this.buildProfile(user);
  }

  async findAll(params: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    role?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const where: any = {};
    if (params.keyword) {
      where.OR = [
        { username: { contains: params.keyword, mode: 'insensitive' } },
        { name: { contains: params.keyword, mode: 'insensitive' } },
      ];
    }
    if (params.role) {
      where.roles = { some: { code: params.role } };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: this.include(),
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map((u) => this.buildProfile(u)), total, page, pageSize };
  }

  async findOne(id: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: this.include() });
    if (!user) throw new NotFoundException('用户不存在');
    return this.buildProfile(user);
  }

  async create(dto: CreateUserDto): Promise<UserProfile> {
    const exists = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (exists) throw new ConflictException('用户名已存在');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        name: dto.name,
        email: dto.email,
        passwordHash,
        status: dto.status ?? 'ACTIVE',
        roles: dto.roleCodes?.length
          ? { connect: dto.roleCodes.map((code) => ({ code })) }
          : undefined,
      },
      include: this.include(),
    });
    return this.buildProfile(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserProfile> {
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 10);
    if (dto.roleCodes) data.roles = { set: dto.roleCodes.map((code) => ({ code })) };

    const user = await this.prisma.user.update({ where: { id }, data, include: this.include() });
    return this.buildProfile(user);
  }

  async remove(id: string): Promise<{ id: string }> {
    await this.findOne(id);
    await this.prisma.user.delete({ where: { id } });
    return { id };
  }
}
