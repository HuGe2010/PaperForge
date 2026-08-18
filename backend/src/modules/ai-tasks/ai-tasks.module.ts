import { Module } from '@nestjs/common';
import { AiTasksController } from './ai-tasks.controller';
import { AiTasksService } from './ai-tasks.service';

@Module({
  controllers: [AiTasksController],
  providers: [AiTasksService],
})
export class AiTasksModule {}
