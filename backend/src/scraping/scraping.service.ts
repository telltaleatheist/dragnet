import { Injectable, Logger } from '@nestjs/common';
import { ItemsService, InsertableItem } from '../database/items.service';
import { ScanHistoryService } from '../database/scan-history.service';
import { SourceStatusService } from '../database/source-status.service';
import { DragnetConfigService } from '../config/dragnet-config.service';
import { RateLimiterService } from './rate-limiter.service';
import { ScrapingGateway } from './scraping.gateway';
import { RedditSource } from './sources/reddit-source';
import { TwitterSource } from './sources/twitter-source';
import { YouTubeSource } from './sources/youtube-source';
import { WebRssSource } from './sources/web-rss-source';
import { RedditSearchSource } from './sources/reddit-search-source';
import { GoogleNewsSource } from './sources/google-news-source';
import { BaseSource, RawContentItem } from './sources/base-source';
import { ScoringService } from '../scoring/scoring.service';

interface SourceTask {
  name: string;
  platform: string;
  source: BaseSource;
  config: any;
}

@Injectable()
export class ScrapingService {
  private readonly logger = new Logger(ScrapingService.name);
  private isScanning = false;
  private isCurating = false;

  constructor(
    private readonly itemsService: ItemsService,
    private readonly scanHistoryService: ScanHistoryService,
    private readonly sourceStatusService: SourceStatusService,
    private readonly configService: DragnetConfigService,
    private readonly rateLimiter: RateLimiterService,
    private readonly gateway: ScrapingGateway,
    private readonly redditSource: RedditSource,
    private readonly twitterSource: TwitterSource,
    private readonly youtubeSource: YouTubeSource,
    private readonly webRssSource: WebRssSource,
    private readonly redditSearchSource: RedditSearchSource,
    private readonly googleNewsSource: GoogleNewsSource,
    private readonly scoringService: ScoringService,
  ) {}

  isRunning(): boolean {
    return this.isScanning;
  }

  isCuratingRunning(): boolean {
    return this.isCurating;
  }

  async triggerCuration(): Promise<{ message: string }> {
    if (this.isScanning || this.isCurating) {
      throw new Error('Scan or curation already in progress');
    }

    this.isCurating = true;
    const startTime = Date.now();

    this.gateway.emitCurateStarted({
      timestamp: new Date().toISOString(),
    });

    this.runCuration(startTime).catch((err) => {
      this.logger.error(`Curation failed: ${err.message}`);
    });

    return { message: 'Curation started' };
  }

  private async runCuration(startTime: number): Promise<void> {
    try {
      this.logger.log('Starting standalone curation...');
      const itemsScored = await this.scoringService.scoreNewItems(
        (batch, totalBatches, scored) => {
          this.gateway.emitScanScoring({ batch, totalBatches, itemsScored: scored });
        },
      );

      const duration = Date.now() - startTime;
      this.gateway.emitCurateComplete({ itemsScored, duration });
      this.gateway.emitFeedUpdated();

      this.logger.log(`Curation complete: ${itemsScored} items scored (${duration}ms)`);
    } catch (err) {
      this.logger.error(`Curation failed: ${(err as Error).message}`);
    } finally {
      this.isCurating = false;
    }
  }

  async triggerScan(): Promise<{ scanId: number }> {
    if (this.isScanning) {
      throw new Error('Scan already in progress');
    }

    this.isScanning = true;
    const scanId = this.scanHistoryService.startScan();
    const startTime = Date.now();

    this.gateway.emitScanStarted({
      scanId,
      timestamp: new Date().toISOString(),
    });

    // Run scan asynchronously
    this.runScan(scanId, startTime).catch((err) => {
      this.logger.error(`Scan ${scanId} failed: ${err.message}`);
    });

    return { scanId };
  }

  private async runScan(scanId: number, startTime: number): Promise<void> {
    const config = this.configService.getConfig();
    const errors: any[] = [];
    let totalFound = 0;
    let totalNew = 0;

    try {
      // Build source task list
      const tasks = this.buildSourceTasks(config);
      const seenUrls = this.itemsService.getSeenUrls();

      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];

        this.gateway.emitScanProgress({
          source: task.name,
          platform: task.platform,
          status: 'fetching',
          itemsFound: 0,
          current: i + 1,
          total: tasks.length,
        });

        try {
          // Rate limit between sources
          await this.rateLimiter.wait(config.settings.requestDelayMs);

          const rawItems = await task.source.fetch(task.config);
          const limited = rawItems.slice(0, config.settings.maxResultsPerSource);

          // Filter out already-seen URLs
          const newRawItems = limited.filter((item) => !seenUrls.has(item.url));

          // Filter out items older than maxItemAgeDays
          const maxAge = config.settings.maxItemAgeDays;
          const cutoff = new Date(Date.now() - maxAge * 24 * 60 * 60 * 1000);
          const freshItems = newRawItems.filter((item) => {
            if (!item.publishedAt) return true; // Keep items without dates
            return new Date(item.publishedAt) >= cutoff;
          });

          // Insert into database
          const insertable: InsertableItem[] = freshItems.map((raw) => ({
            url: raw.url,
            title: raw.title,
            author: raw.author,
            platform: raw.platform,
            contentType: raw.contentType,
            textContent: raw.textContent,
            publishedAt: raw.publishedAt,
            thumbnailUrl: raw.thumbnailUrl,
            sourceAccount: raw.sourceAccount,
            metadata: raw.metadata,
          }));

          const inserted = this.itemsService.insertItems(insertable);

          // Add to seen set so subsequent sources don't re-insert
          freshItems.forEach((item) => seenUrls.add(item.url));

          totalFound += limited.length;
          totalNew += inserted;

          this.sourceStatusService.recordSuccess(task.name, task.platform, inserted);

          this.gateway.emitScanProgress({
            source: task.name,
            platform: task.platform,
            status: 'complete',
            itemsFound: limited.length,
            current: i + 1,
            total: tasks.length,
          });

          this.logger.log(
            `${task.name}: found ${limited.length}, inserted ${inserted} new`,
          );
        } catch (err) {
          const message = (err as Error).message;
          errors.push({ source: task.name, platform: task.platform, error: message });
          this.sourceStatusService.recordError(task.name, task.platform, message);

          this.gateway.emitScanProgress({
            source: task.name,
            platform: task.platform,
            status: 'error',
            itemsFound: 0,
            current: i + 1,
            total: tasks.length,
          });

          this.logger.warn(`${task.name} error: ${message}`);
        }
      }

      // Complete scan
      const duration = Date.now() - startTime;
      this.scanHistoryService.completeScan(scanId, totalFound, totalNew, 0, errors);

      this.gateway.emitScanComplete({
        scanId,
        itemsFound: totalFound,
        newItems: totalNew,
        itemsScored: 0,
        errors,
        duration,
      });

      this.gateway.emitFeedUpdated();

      this.logger.log(
        `Scan ${scanId} complete: ${totalFound} found, ${totalNew} new, ${errors.length} errors (${duration}ms)`,
      );
    } catch (err) {
      const message = (err as Error).message;
      this.scanHistoryService.failScan(scanId, message);
      this.gateway.emitScanError({ error: message });
      this.logger.error(`Scan ${scanId} failed: ${message}`);
    } finally {
      this.isScanning = false;
    }
  }

  private buildSourceTasks(config: any): SourceTask[] {
    const tasks: SourceTask[] = [];
    const sources = config.sources;

    if (sources.reddit?.enabled) {
      tasks.push({
        name: 'reddit',
        platform: 'reddit',
        source: this.redditSource,
        config: sources.reddit,
      });
    }

    if (sources.twitter?.enabled) {
      tasks.push({
        name: 'twitter',
        platform: 'twitter',
        source: this.twitterSource,
        config: sources.twitter,
      });
    }

    if (sources.youtube?.enabled) {
      tasks.push({
        name: 'youtube',
        platform: 'youtube',
        source: this.youtubeSource,
        config: sources.youtube,
      });
    }

    if (sources.webRss?.enabled) {
      tasks.push({
        name: 'web-rss',
        platform: 'web',
        source: this.webRssSource,
        config: sources.webRss,
      });
    }

    if (sources.redditSearch?.enabled) {
      tasks.push({
        name: 'reddit-search',
        platform: 'reddit',
        source: this.redditSearchSource,
        config: { ...sources.redditSearch, subjects: config.subjects, figures: config.figures },
      });
    }

    if (sources.googleNews?.enabled) {
      tasks.push({
        name: 'google-news',
        platform: 'web',
        source: this.googleNewsSource,
        config: { ...sources.googleNews, subjects: config.subjects, figures: config.figures },
      });
    }

    return tasks;
  }
}
