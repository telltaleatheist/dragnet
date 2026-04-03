import { Controller, Post, Get, Body } from '@nestjs/common';
import { ScrapingService } from './scraping.service';

@Controller('scan')
export class ScrapingController {
  constructor(
    private readonly scrapingService: ScrapingService,
  ) {}

  @Post('trigger')
  async triggerScan(): Promise<{ message: string }> {
    return this.scrapingService.triggerScan();
  }

  @Post('curate')
  async triggerCurate(
    @Body() body?: { customInstructions?: string },
  ): Promise<{ message: string }> {
    return this.scrapingService.triggerCuration(body?.customInstructions);
  }

  @Get('status')
  getStatus(): { scanning: boolean; curating: boolean } {
    return {
      scanning: this.scrapingService.isRunning(),
      curating: this.scrapingService.isCuratingRunning(),
    };
  }
}
