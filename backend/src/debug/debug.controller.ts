import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { DebugService } from './debug.service';
import { ScrapingService } from '../scraping/scraping.service';
import { ScrapingGateway } from '../scraping/scraping.gateway';

@Controller('debug')
export class DebugController {
  constructor(
    private readonly debugService: DebugService,
    private readonly scrapingService: ScrapingService,
    private readonly gateway: ScrapingGateway,
  ) {}

  @Get('snapshots')
  listSnapshots() {
    return this.debugService.listSnapshots();
  }

  @Post('snapshots')
  saveSnapshot(@Body() body: { name: string }) {
    if (!body.name?.trim()) {
      throw new HttpException('Snapshot name is required', HttpStatus.BAD_REQUEST);
    }
    return this.debugService.saveSnapshot(body.name.trim());
  }

  @Delete('snapshots/:id')
  deleteSnapshot(@Param('id') id: string) {
    this.debugService.deleteSnapshot(id);
    return { success: true };
  }

  @Post('snapshots/:id/load')
  loadSnapshot(@Param('id') id: string) {
    const loaded = this.debugService.loadSnapshot(id);
    this.gateway.emitFeedUpdated();
    return { loaded };
  }

  @Post('snapshots/:id/curate')
  async curateSnapshot(
    @Param('id') id: string,
    @Body() body?: { customInstructions?: string },
  ) {
    const loaded = this.debugService.loadSnapshot(id);
    const result = await this.scrapingService.triggerCuration(body?.customInstructions);
    return { loaded, message: result.message };
  }
}
