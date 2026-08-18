import { Controller, Get, Inject } from '@nestjs/common';
import { HealthCheckService, HealthCheck, HealthIndicatorResult } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma.health';
import { REDIS_CLIENT } from '../../redis/redis.module';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: PrismaHealthIndicator,
    @Inject(REDIS_CLIENT) private readonly redis: any,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.db.pingCheck('database'), () => this.redisCheck()]);
  }

  private async redisCheck(): Promise<HealthIndicatorResult> {
    try {
      if (this.redis.status !== 'ready') {
        await this.redis.connect();
      }
      await this.redis.ping();
      return { redis: { status: 'up' } };
    } catch (e) {
      return { redis: { status: 'down', message: (e as Error).message } };
    }
  }
}
