import { Module } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { QuestionsController } from './questions.controller';
import { LlmModule } from '../llm/llm.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [LlmModule, SettingsModule],
  controllers: [QuestionsController],
  providers: [QuestionsService],
  exports: [QuestionsService],
})
export class QuestionsModule {}
