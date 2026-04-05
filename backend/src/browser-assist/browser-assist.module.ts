import { Module } from '@nestjs/common';
import { BrowserAssistController } from './browser-assist.controller';
import { BrowserAssistService } from './browser-assist.service';
@Module({
  controllers: [BrowserAssistController],
  providers: [BrowserAssistService],
})
export class BrowserAssistModule {}
