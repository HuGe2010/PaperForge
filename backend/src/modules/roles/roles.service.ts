import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { SetPermissionsDto } from './dto/set-permissions.dto';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  private include() {
    return { permissions: true } as const;
  }

  findAll() {
    return this.prisma.role.findMany({ include: this.include(), orderBy: { createdAt: 'asc' } });
  }

  async findOne(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id }, include: this.include() });
    if (!role) throw new NotFoundException('角色不存在');
    return role;
  }

  async create(dto: CreateRoleDto) {
    const exists = await this.prisma.role.findUnique({ where: { code: dto.code } });
    if (exists) throw new BadRequestException('角色编码已存在');
    return this.prisma.role.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        permissions: dto.permissionCodes?.length
          ? { connect: dto.permissionCodes.map((code) => ({ code })) }
          : undefined,
      },
      include: this.include(),
    });
  }

  async update(id: string, dto: UpdateRoleDto) {
    await this.findOne(id);
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.permissionCodes) {
      data.permissions = { set: dto.permissionCodes.map((code) => ({ code })) };
    }
    return this.prisma.role.update({ where: { id }, data, include: this.include() });
  }

  async remove(id: string) {
    const role = await this.findOne(id);
    if (role.isSystem) throw new BadRequestException('系统内置角色不可删除');
    await this.prisma.role.delete({ where: { id } });
    return { id };
  }

  async setPermissions(id: string, dto: SetPermissionsDto) {
    await this.findOne(id);
    return this.prisma.role.update({
      where: { id },
      data: { permissions: { set: dto.permissionCodes.map((code) => ({ code })) } },
      include: this.include(),
    });
  }
}
