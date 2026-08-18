import { Module } from '@nestjs/common';
import { PapersController } from './papers.controller';
import { PapersService } from './papers.service';

@Module({
  controllers: [PapersController],
  providers: [PapersService],
  exports: [PapersService],
})
export class PapersModule {}
