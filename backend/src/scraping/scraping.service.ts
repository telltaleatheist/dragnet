import { Injectable, Logger } from '@nestjs/common';
import { InMemoryStoreService } from '../store/in-memory-store.service';
import { DragnetConfigService } from '../config/dragnet-config.service';
import { RateLimiterService } from './rate-limiter.service';
import { ScrapingGateway } from './scraping.gateway';
import { RedditSource } from './sources/reddit-source';
import { TwitterSource } from './sources/twitter-source';
import { YouTubeSource } from './sources/youtube-source';
import { WebRssSource } from './sources/web-rss-source';
import { RedditSearchSource } from './sources/reddit-search-source';
import { GoogleNewsSource } from './sources/google-news-source';
import { TikTokDiscoverySource } from './sources/tiktok-discovery-source';
import { InstagramDiscoverySource } from './sources/instagram-discovery-source';
import { BaseSource } from './sources/base-source';
import { ScoringService } from '../scoring/scoring.service';
import { ClusteringService } from '../scoring/clustering.service';
import { AIProviderService, AIProviderConfig } from '../scoring/ai-provider.service';
import { ExpansionPromptService } from '../scoring/expansion-prompt.service';
import { ContentItem, SubjectProfile } from '../../../shared/types';

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
    private readonly store: InMemoryStoreService,
    private readonly configService: DragnetConfigService,
    private readonly rateLimiter: RateLimiterService,
    private readonly gateway: ScrapingGateway,
    private readonly redditSource: RedditSource,
    private readonly twitterSource: TwitterSource,
    private readonly youtubeSource: YouTubeSource,
    private readonly webRssSource: WebRssSource,
    private readonly redditSearchSource: RedditSearchSource,
    private readonly googleNewsSource: GoogleNewsSource,
    private readonly tiktokDiscoverySource: TikTokDiscoverySource,
    private readonly instagramDiscoverySource: InstagramDiscoverySource,
    private readonly scoringService: ScoringService,
    private readonly clusteringService: ClusteringService,
    private readonly aiProvider: AIProviderService,
    private readonly expansionPromptService: ExpansionPromptService,
  ) {}

  isRunning(): boolean {
    return this.isScanning;
  }

  isCuratingRunning(): boolean {
    return this.isCurating;
  }

  async triggerCuration(customInstructions?: string): Promise<{ message: string }> {
    if (this.isScanning || this.isCurating) {
      throw new Error('Scan or curation already in progress');
    }

    this.isCurating = true;
    const startTime = Date.now();

    this.gateway.emitCurateStarted({
      timestamp: new Date().toISOString(),
    });

    this.runCuration(startTime, customInstructions).catch((err) => {
      this.logger.error(`Curation failed: ${err.message}`);
    });

    return { message: 'Curation started' };
  }

  private async runCuration(startTime: number, customInstructions?: string): Promise<void> {
    try {
      this.logger.log('Starting curation: Pass 1 — AI scoring...');

      // Pass 1: Score items
      let itemsScored = await this.scoringService.scoreNewItems(
        (batch, totalBatches, scored) => {
          this.gateway.emitClusteringProgress({
            phase: 'scoring',
            batch,
            totalBatches,
            itemsProcessed: scored,
            totalItems: this.store.getUnscoredItems().length + scored,
          });
        },
        customInstructions,
      );

      // Pass 2: Cluster scored items
      this.logger.log('Starting curation: Pass 2 — clustering...');
      this.gateway.emitClusteringProgress({
        phase: 'clustering',
        itemsProcessed: 0,
        totalItems: this.store.getScoredItems().length,
      });

      let clustersCreated = await this.clusteringService.clusterScoredItems(
        (processed, total) => {
          this.gateway.emitClusteringProgress({
            phase: 'clustering',
            itemsProcessed: processed,
            totalItems: total,
          });
        },
      );

      // Pass 3-6: Expansion (if clusters exist)
      const clusters = this.store.getClusters();
      if (clusters.length > 0) {
        const expansionItems = await this.runExpansion(clusters, customInstructions);
        if (expansionItems > 0) {
          // Pass 5: Re-score new items
          this.logger.log('Starting curation: Pass 5 — re-scoring expansion items...');
          const reScored = await this.scoringService.scoreNewItems(
            (batch, totalBatches, scored) => {
              this.gateway.emitClusteringProgress({
                phase: 'scoring',
                batch,
                totalBatches,
                itemsProcessed: scored,
                totalItems: this.store.getUnscoredItems().length + scored,
              });
            },
            customInstructions,
          );
          itemsScored += reScored;

          // Pass 6: Merge new items into existing clusters
          this.logger.log('Starting curation: Pass 6 — merging expansion items into clusters...');
          this.gateway.emitClusteringProgress({
            phase: 'clustering',
            itemsProcessed: 0,
            totalItems: this.store.getScoredItems().length,
          });

          clustersCreated = await this.clusteringService.mergeNewItems(
            (processed, total) => {
              this.gateway.emitClusteringProgress({
                phase: 'clustering',
                itemsProcessed: processed,
                totalItems: total,
              });
            },
          );
        }
      }

      const duration = Date.now() - startTime;
      this.gateway.emitCurateComplete({ itemsScored, clustersCreated, duration });
      this.gateway.emitFeedUpdated();

      this.logger.log(`Curation complete: ${itemsScored} scored, ${clustersCreated} clusters (${duration}ms)`);
    } catch (err) {
      this.logger.error(`Curation failed: ${(err as Error).message}`);
    } finally {
      this.isCurating = false;
    }
  }

  private async runExpansion(clusters: import('../../../shared/types').StoryCluster[], customInstructions?: string): Promise<number> {
    const config = this.configService.getConfig();
    const scoredItems = this.store.getScoredItems();

    // Pass 3: AI suggests expansion terms
    this.logger.log('Starting curation: Pass 3 — AI expansion term generation...');
    this.gateway.emitClusteringProgress({
      phase: 'expanding',
      itemsProcessed: 0,
      totalItems: clusters.length,
    });

    const aiConfig: AIProviderConfig = {
      provider: config.scoring.aiProvider,
      model: config.scoring.aiModel,
      apiKey: config.scoring.aiProvider === 'claude'
        ? config.scoring.claudeApiKey
        : config.scoring.openaiApiKey,
      ollamaEndpoint: config.scoring.ollamaEndpoint,
    };

    const prompt = this.expansionPromptService.buildExpansionPrompt(
      clusters, scoredItems, config.subjects, config.figures,
    );

    let searchTerms: { term: string; cluster: string; rationale: string }[] = [];
    try {
      const response = await this.aiProvider.generateText(prompt, aiConfig, 4096);
      searchTerms = this.parseExpansionResponse(response.text);
      this.logger.log(`AI suggested ${searchTerms.length} expansion terms`);
      for (const t of searchTerms) {
        this.logger.log(`  Expansion: "${t.term}" (${t.cluster}) — ${t.rationale}`);
      }
    } catch (err) {
      this.logger.error(`Expansion term generation failed: ${(err as Error).message}`);
      return 0;
    }

    if (searchTerms.length === 0) return 0;

    // Pass 4: Search discovery platforms with synthetic subjects
    this.logger.log(`Starting curation: Pass 4 — searching ${searchTerms.length} expansion terms...`);

    const syntheticSubjects: SubjectProfile[] = searchTerms.map((t, i) => ({
      id: `expansion_${i}`,
      label: t.term,
      color: '#888888',
      keywords: [t.term],
      enabled: true,
      priority: 5,
    }));

    const sources = config.sources;
    const seenUrls = this.store.getSeenUrls();
    const maxAge = config.settings.maxItemAgeDays;
    const cutoff = new Date(Date.now() - maxAge * 24 * 60 * 60 * 1000);
    let totalInserted = 0;

    // Build discovery tasks from enabled sources
    const discoveryTasks: { name: string; platform: string; source: BaseSource }[] = [];
    if (sources.redditSearch?.enabled) {
      discoveryTasks.push({ name: 'reddit-search', platform: 'reddit', source: this.redditSearchSource });
    }
    if (sources.googleNews?.enabled) {
      discoveryTasks.push({ name: 'google-news', platform: 'web', source: this.googleNewsSource });
    }
    if (sources.tiktokDiscovery?.enabled) {
      discoveryTasks.push({ name: 'tiktok-discovery', platform: 'tiktok', source: this.tiktokDiscoverySource });
    }
    if (sources.instagramDiscovery?.enabled) {
      discoveryTasks.push({ name: 'instagram-discovery', platform: 'web', source: this.instagramDiscoverySource });
    }

    // Run all discovery sources in parallel — they hit different APIs
    const sourceConfig = { enabled: true, subjects: syntheticSubjects, figures: [] };
    let completedCount = 0;

    this.gateway.emitClusteringProgress({
      phase: 'expanding',
      itemsProcessed: 0,
      totalItems: discoveryTasks.length,
    });

    const results = await Promise.allSettled(
      discoveryTasks.map(async (task) => {
        try {
          const rawItems = await task.source.fetch(sourceConfig);
          const limited = rawItems.slice(0, config.settings.maxResultsPerSource);

          // Filter dupes and old items
          const freshNew = limited.filter((item) => {
            if (seenUrls.has(item.url)) return false;
            if (item.publishedAt && new Date(item.publishedAt) < cutoff) return false;
            return true;
          });

          const contentItems: ContentItem[] = freshNew.map((raw) => ({
            id: '',
            url: raw.url,
            title: raw.title,
            author: raw.author,
            platform: raw.platform as any,
            contentType: raw.contentType as any,
            textContent: raw.textContent,
            publishedAt: raw.publishedAt,
            fetchedAt: new Date().toISOString(),
            thumbnailUrl: raw.thumbnailUrl,
            sourceAccount: raw.sourceAccount,
            metadata: raw.metadata,
          }));

          const inserted = this.store.addItems(contentItems as any);
          completedCount++;
          this.gateway.emitClusteringProgress({
            phase: 'expanding',
            itemsProcessed: completedCount,
            totalItems: discoveryTasks.length,
          });

          this.logger.log(`Expansion ${task.name}: found ${limited.length}, inserted ${inserted} new`);
          return inserted;
        } catch (err) {
          completedCount++;
          this.gateway.emitClusteringProgress({
            phase: 'expanding',
            itemsProcessed: completedCount,
            totalItems: discoveryTasks.length,
          });
          this.logger.warn(`Expansion ${task.name} failed: ${(err as Error).message}`);
          return 0;
        }
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled') totalInserted += r.value;
    }

    this.logger.log(`Expansion complete: ${totalInserted} new items from ${discoveryTasks.length} sources`);
    return totalInserted;
  }

  private parseExpansionResponse(text: string): { term: string; cluster: string; rationale: string }[] {
    try {
      let jsonStr = text.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) {
        this.logger.warn('Expansion response is not an array');
        return [];
      }

      return parsed
        .filter((t: any) => t.term && typeof t.term === 'string')
        .map((t: any) => ({
          term: t.term.trim(),
          cluster: t.cluster || '',
          rationale: t.rationale || '',
        }))
        .slice(0, 20);
    } catch (err) {
      this.logger.error(`Failed to parse expansion response: ${(err as Error).message}`);
      this.logger.debug(`Raw expansion response: ${text.slice(0, 500)}`);
      return [];
    }
  }

  async triggerScan(): Promise<{ message: string }> {
    if (this.isScanning) {
      throw new Error('Scan already in progress');
    }

    this.isScanning = true;
    const startTime = Date.now();

    this.gateway.emitScanStarted({
      scanId: Date.now().toString(),
      timestamp: new Date().toISOString(),
    });

    this.runScan(startTime).catch((err) => {
      this.logger.error(`Scan failed: ${err.message}`);
    });

    return { message: 'Scan started' };
  }

  private async runScan(startTime: number): Promise<void> {
    const config = this.configService.getConfig();
    const errors: any[] = [];
    let totalFound = 0;
    let totalNew = 0;

    try {
      const tasks = this.buildSourceTasks(config);
      const seenUrls = this.store.getSeenUrls();

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
          await this.rateLimiter.wait(config.settings.requestDelayMs);

          const rawItems = await task.source.fetch(task.config);
          const limited = rawItems.slice(0, config.settings.maxResultsPerSource);

          // Filter out already-seen URLs
          const newRawItems = limited.filter((item) => !seenUrls.has(item.url));

          // Filter out items older than maxItemAgeDays
          const maxAge = config.settings.maxItemAgeDays;
          const cutoff = new Date(Date.now() - maxAge * 24 * 60 * 60 * 1000);
          const freshItems = newRawItems.filter((item) => {
            if (!item.publishedAt) return true;
            return new Date(item.publishedAt) >= cutoff;
          });

          // Insert into in-memory store
          const contentItems: ContentItem[] = freshItems.map((raw) => ({
            id: '',
            url: raw.url,
            title: raw.title,
            author: raw.author,
            platform: raw.platform as any,
            contentType: raw.contentType as any,
            textContent: raw.textContent,
            publishedAt: raw.publishedAt,
            fetchedAt: new Date().toISOString(),
            thumbnailUrl: raw.thumbnailUrl,
            sourceAccount: raw.sourceAccount,
            metadata: raw.metadata,
          }));

          const inserted = this.store.addItems(contentItems as any);

          totalFound += limited.length;
          totalNew += inserted;

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

      const duration = Date.now() - startTime;

      this.gateway.emitScanComplete({
        itemsFound: totalFound,
        newItems: totalNew,
        errors,
        duration,
      });

      this.gateway.emitFeedUpdated();

      this.logger.log(
        `Scan complete: ${totalFound} found, ${totalNew} new, ${errors.length} errors (${duration}ms)`,
      );
    } catch (err) {
      const message = (err as Error).message;
      this.gateway.emitScanError({ error: message });
      this.logger.error(`Scan failed: ${message}`);
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

    if (sources.tiktokDiscovery?.enabled) {
      tasks.push({
        name: 'tiktok-discovery',
        platform: 'tiktok',
        source: this.tiktokDiscoverySource,
        config: { ...sources.tiktokDiscovery, subjects: config.subjects, figures: config.figures },
      });
    }

    if (sources.instagramDiscovery?.enabled) {
      tasks.push({
        name: 'instagram-discovery',
        platform: 'web',
        source: this.instagramDiscoverySource,
        config: { ...sources.instagramDiscovery, subjects: config.subjects, figures: config.figures },
      });
    }

    return tasks;
  }
}
