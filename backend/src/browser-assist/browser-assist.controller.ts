import { Controller, Post, Body } from '@nestjs/common';
import { BrowserAssistService } from './browser-assist.service';

@Controller('browser-assist')
export class BrowserAssistController {
  constructor(private readonly browserAssistService: BrowserAssistService) {}

  @Post('generate-prompts')
  generatePrompts(@Body() body: { platforms: string[]; searchTerms?: string[]; videoOnly?: boolean; adversarial?: boolean; maxAgeDays?: number }) {
    return this.browserAssistService.generatePrompts(body.platforms, body.searchTerms, body.videoOnly, body.adversarial, body.maxAgeDays);
  }

  @Post('import')
  importUrls(@Body() body: { rawText: string }) {
    return this.browserAssistService.importUrls(body.rawText);
  }
}
