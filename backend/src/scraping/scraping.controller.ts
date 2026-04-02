import { Controller, Post, Get } from '@nestjs/common';
import { ScrapingService } from './scraping.service';
import { ScanHistoryService, ScanRecord } from '../database/scan-history.service';

@Controller('scan')
export class ScrapingController {
  constructor(
    private readonly scrapingService: ScrapingService,
    private readonly scanHistoryService: ScanHistoryService,
  ) {}

  @Post('trigger')
  async triggerScan(): Promise<{ scanId: number }> {
    return this.scrapingService.triggerScan();
  }

  @Post('curate')
  async triggerCurate(): Promise<{ message: string }> {
    return this.scrapingService.triggerCuration();
  }

  @Get('status')
  getStatus(): { running: boolean; lastScan: ScanRecord | null } {
    return {
      running: this.scrapingService.isRunning(),
      lastScan: this.scanHistoryService.getLastScan(),
    };
  }

  @Get('history')
  getHistory(): ScanRecord[] {
    return this.scanHistoryService.getScanHistory();
  }
}
