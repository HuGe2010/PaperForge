import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import * as crypto from 'crypto';

export interface SettingItemInput {
  key: string;
  value: string | null;
  isSecret?: boolean;
}

/**
 * 系统设置服务。
 * - 密钥类配置（如 AI API Key）加密存储（AES-256-GCM），不进 compose / 不进镜像。
 * - 提供内部解密读取方法，供 AI / 导出模块运行时使用。
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaService, private readonly cfg: ConfigService) {}

  private key(): Buffer {
    const secret =
      this.cfg.get<string>('SETTINGS_SECRET') || this.cfg.get<string>('JWT_SECRET') || 'dev-secret';
    return crypto.createHash('sha256').update(secret).digest();
  }

  private encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key(), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
  }

  private decrypt(encoded: string): string {
    const [ivB64, tagB64, encB64] = encoded.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  async upsert(group: string, key: string, value: string | null, isSecret: boolean, userId?: string) {
    const stored = isSecret && value ? this.encrypt(value) : value;
    await this.prisma.setting.upsert({
      where: { group_key: { group, key } },
      update: { value: stored, isSecret, updatedById: userId },
      create: { group, key, value: stored, isSecret, updatedById: userId },
    });
  }

  async setGroup(group: string, items: SettingItemInput[], userId?: string) {
    for (const it of items) {
      await this.upsert(group, it.key, it.value, it.isSecret ?? false, userId);
    }
    return this.getGroupView(group);
  }

  async getGroupView(group: string) {
    const rows = await this.prisma.setting.findMany({ where: { group } });
    return rows.map((r) => ({
      key: r.key,
      isSecret: r.isSecret,
      hasValue: !!r.value,
      value: r.isSecret ? undefined : r.value,
      updatedAt: r.updatedAt,
    }));
  }

  async getAllView() {
    const rows = await this.prisma.setting.findMany();
    const groups: Record<string, any[]> = {};
    for (const r of rows) {
      (groups[r.group] ??= []).push({
        key: r.key,
        isSecret: r.isSecret,
        hasValue: !!r.value,
        value: r.isSecret ? undefined : r.value,
        updatedAt: r.updatedAt,
      });
    }
    return groups;
  }

  /** 内部使用：读取解密后的真实值（含密钥） */
  async getDecrypted(group: string, key: string): Promise<string | null> {
    const row = await this.prisma.setting.findUnique({ where: { group_key: { group, key } } });
    if (!row || row.value == null) return null;
    return row.isSecret ? this.decrypt(row.value) : row.value;
  }

  /** 读取整组配置（含解密值），供 AI / 导出模块使用 */
  async getGroupDecrypted(group: string): Promise<Record<string, string | null>> {
    const rows = await this.prisma.setting.findMany({ where: { group } });
    const out: Record<string, string | null> = {};
    for (const r of rows) {
      out[r.key] = r.value == null ? null : r.isSecret ? this.decrypt(r.value) : r.value;
    }
    return out;
  }
}
