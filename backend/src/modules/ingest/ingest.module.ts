import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { VlmService } from './vlm/vlm.service';
import { OcrDetectService } from './vlm/ocr-detect.service';
import { QuestionsModule } from '../questions/questions.module';
import { SettingsModule } from '../settings/settings.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [QuestionsModule, SettingsModule, LlmModule],
  controllers: [IngestController],
  providers: [IngestService, VlmService, OcrDetectService],
  exports: [IngestService],
})
export class IngestModule {}
