import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AiTasksService } from './ai-tasks.service';

@Controller('ai-tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TEACHER', 'ADMIN')
export class AiTasksController {
  constructor(private readonly service: AiTasksService) {}

  @Get()
  list(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
  ) {
    const n = (v: string | undefined, d: number) => {
      const x = Number(v);
      return Number.isFinite(x) && x > 0 ? Math.round(x) : d;
    };
    return this.service.list({
      limit: Math.min(200, n(limit, 50)),
      status: status || undefined,
      page: n(page, 1),
    });
  }
}
