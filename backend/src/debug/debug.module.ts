import { Module } from '@nestjs/common';
import { DebugService } from './debug.service';
import { DebugController } from './debug.controller';
import { ScrapingModule } from '../scraping/scraping.module';

@Module({
  imports: [ScrapingModule],
  controllers: [DebugController],
  providers: [DebugService],
})
export class DebugModule {}
