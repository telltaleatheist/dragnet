import { Controller, Post, Get, Body } from '@nestjs/common';
import { ScrapingService } from './scraping.service';

@Controller('scan')
export class ScrapingController {
  constructor(
    private readonly scrapingService: ScrapingService,
  ) {}

  @Post('trigger')
  async triggerScan(
    @Body() body?: { videoOnly?: boolean; adversarial?: boolean; maxAgeDays?: number; searchTerms?: string[] },
  ): Promise<{ message: string }> {
    return this.scrapingService.triggerScan(body?.videoOnly, body?.adversarial, body?.maxAgeDays, body?.searchTerms);
  }

  @Post('curate')
  async triggerCurate(
    @Body() body?: { customInstructions?: string; storeIds?: string[]; adversarial?: boolean; maxAgeDays?: number },
  ): Promise<{ message: string }> {
    return this.scrapingService.triggerCuration(body?.customInstructions, body?.storeIds, body?.adversarial, body?.maxAgeDays);
  }

  @Post('quick-search')
  async triggerQuickSearch(
    @Body() body: { query: string; aiExpand?: boolean; videoOnly?: boolean; adversarial?: boolean; maxAgeDays?: number },
  ): Promise<{ message: string }> {
    return this.scrapingService.triggerQuickSearch(body.query, body.aiExpand, body?.videoOnly, body?.adversarial, body?.maxAgeDays);
  }

  @Post('suggest-search-terms')
  async suggestSearchTerms(
    @Body() body: { topics: string[]; figures: string[] },
  ): Promise<{ terms: string[] }> {
    return this.scrapingService.suggestSearchTerms(body.topics || [], body.figures || []);
  }

  @Post('advanced-search')
  async triggerAdvancedSearch(
    @Body() body: { terms: string[]; videoOnly?: boolean; adversarial?: boolean; maxAgeDays?: number },
  ): Promise<{ message: string }> {
    return this.scrapingService.triggerAdvancedSearch(body.terms, body.videoOnly, body.adversarial, body.maxAgeDays);
  }

  @Post('cancel-scan')
  cancelScan(): { message: string } {
    return this.scrapingService.cancelScan();
  }

  @Post('cancel-curate')
  cancelCurate(): { message: string } {
    return this.scrapingService.cancelCuration();
  }

  @Post('cancel-search')
  cancelSearch(): { message: string } {
    return this.scrapingService.cancelSearch();
  }

  @Get('status')
  getStatus(): { scanning: boolean; curating: boolean; searching: boolean } {
    return {
      scanning: this.scrapingService.isRunning(),
      curating: this.scrapingService.isCuratingRunning(),
      searching: this.scrapingService.isSearchRunning(),
    };
  }
}
