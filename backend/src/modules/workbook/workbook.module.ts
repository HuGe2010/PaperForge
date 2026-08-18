import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WorkbookService } from './workbook.service';
import { WorkbookController } from './workbook.controller';

@Module({
  imports: [PrismaModule],
  controllers: [WorkbookController],
  providers: [WorkbookService],
  exports: [WorkbookService],
})
export class WorkbookModule {}
