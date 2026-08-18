import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { SettingsModule } from './modules/settings/settings.module';
import { HealthModule } from './modules/health/health.module';
import { SubjectsModule } from './modules/subjects/subjects.module';
import { TagsModule } from './modules/tags/tags.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { QuestionsModule } from './modules/questions/questions.module';
import { IngestModule } from './modules/ingest/ingest.module';
import { WorkbookModule } from './modules/workbook/workbook.module';
import { LlmModule } from './modules/llm/llm.module';
import { PapersModule } from './modules/papers/papers.module';
import { AiTasksModule } from './modules/ai-tasks/ai-tasks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '.env.local'] }),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    SettingsModule,
    HealthModule,
    SubjectsModule,
    TagsModule,
    KnowledgeModule,
    QuestionsModule,
    IngestModule,
    WorkbookModule,
    LlmModule,
    PapersModule,
    AiTasksModule,
  ],
})
export class AppModule {}
