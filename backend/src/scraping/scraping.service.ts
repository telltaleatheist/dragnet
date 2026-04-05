import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
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
import { SubstackDiscoverySource } from './sources/substack-discovery-source';
import { TwitterDiscoverySource } from './sources/twitter-discovery-source';
import { YouTubeShortsDiscoverySource } from './sources/youtube-shorts-discovery-source';
import { BaseSource } from './sources/base-source';
import { ScoringService } from '../scoring/scoring.service';
import { AIProviderService, AIProviderConfig } from '../scoring/ai-provider.service';
import { ExpansionPromptService } from '../scoring/expansion-prompt.service';
import { ProfileService } from '../profile/profile.service';
import { SourceDiscoveryService } from '../profile/source-discovery.service';
import { ContentItem, SubjectProfile } from '../../../shared/types';
import { safeJsonParse } from '../scoring/json-parse';

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
  private isSearching = false;
  private scanCancelled = false;
  private curateCancelled = false;
  private searchCancelled = false;

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
    private readonly substackDiscoverySource: SubstackDiscoverySource,
    private readonly twitterDiscoverySource: TwitterDiscoverySource,
    private readonly youtubeShortsDiscoverySource: YouTubeShortsDiscoverySource,
    private readonly scoringService: ScoringService,
    private readonly aiProvider: AIProviderService,
    private readonly expansionPromptService: ExpansionPromptService,
    @Inject(forwardRef(() => ProfileService))
    private readonly profileService: ProfileService,
    private readonly sourceDiscovery: SourceDiscoveryService,
  ) {}

  isRunning(): boolean {
    return this.isScanning;
  }

  isCuratingRunning(): boolean {
    return this.isCurating;
  }

  isSearchRunning(): boolean {
    return this.isSearching;
  }

  cancelScan(): { message: string } {
    this.scanCancelled = true;
    if (!this.isScanning) {
      this.logger.log('Cancel scan requested but no scan in progress');
      return { message: 'No scan in progress' };
    }
    this.isScanning = false;
    this.logger.log('Scan cancellation requested');
    return { message: 'Scan cancelled' };
  }

  cancelCuration(): { message: string } {
    this.curateCancelled = true;
    if (!this.isCurating) {
      this.logger.log('Cancel curation requested but no curation in progress');
      return { message: 'No curation in progress' };
    }
    this.isCurating = false;
    this.logger.log('Curation cancellation requested');
    return { message: 'Curation cancelled' };
  }

  cancelSearch(): { message: string } {
    this.searchCancelled = true;
    if (!this.isSearching) {
      this.logger.log('Cancel search requested but no search in progress');
      return { message: 'No search in progress' };
    }
    // Clear isSearching immediately so a new search can start right away.
    // The old search continues in the background but its finally block is harmless.
    this.isSearching = false;
    this.logger.log('Search cancellation requested');
    return { message: 'Search cancelled' };
  }

  async triggerCuration(customInstructions?: string, storeIds?: string[], adversarial = false, maxAgeDays?: number): Promise<{ message: string }> {
    if (this.isCurating) throw new Error('Curation already in progress');
    if (this.isScanning) throw new Error('Cannot curate while scan is in progress');
    if (this.isSearching) throw new Error('Cannot curate while search is in progress');

    this.isCurating = true;
    this.curateCancelled = false;
    const startTime = Date.now();

    this.gateway.emitCurateStarted({
      timestamp: new Date().toISOString(),
    });

    this.runCuration(startTime, customInstructions, storeIds, adversarial, maxAgeDays).catch((err) => {
      this.logger.error(`Curation failed: ${err.message}`);
    });

    return { message: 'Curation started' };
  }

  private async runCuration(startTime: number, customInstructions?: string, storeIds?: string[], adversarial = false, maxAgeDays?: number): Promise<void> {
    // Reload config from the active profile so changes are picked up
    this.configService.reloadActiveProfile();

    const scoringTarget = this.scoringService.targetForStores(storeIds, maxAgeDays);

    try {
      // === Step 1+2: Triage + Classify (produces scores AND clusters) ===
      this.logger.log(`Curation step 1/2 — triage + classify${storeIds?.length ? ` (stores: ${storeIds.length})` : ''}${maxAgeDays ? ` (maxAge: ${maxAgeDays}d)` : ''}...`);

      const unscoredCount = this.store.getUnscoredItems(storeIds).length;

      this.gateway.emitClusteringProgress({
        phase: 'scoring',
        itemsProcessed: 0,
        totalItems: unscoredCount,
      });

      // Derive search context from targeted stores so triage uses search-aware prompts
      // instead of profile-based ones (which would reject items not matching profile subjects)
      let searchQuery: string | undefined;
      if (storeIds?.length) {
        const allTerms: string[] = [];
        for (const sid of storeIds) {
          const s = this.store.getStore(sid);
          if (s?.searchTerms?.length) allTerms.push(...s.searchTerms);
        }
        if (allTerms.length > 0) {
          searchQuery = allTerms.slice(0, 10).join(', ');
          this.logger.log(`Curation using search context: "${searchQuery}"`);
        }
      }

      // Adversarial mode: prepend contrarian/critical scoring instructions
      let effectiveInstructions = customInstructions;
      if (adversarial) {
        const adversarialPreamble = `ADVERSARIAL MODE: The user wants to find contrarian, critical, hostile, and fringe perspectives on the topics they're researching. Score HIGHER for content that is:
- Strongly critical, negative, or contrarian toward the subject matter
- From niche communities, fringe voices, or outsider perspectives (primary sources, not mainstream reporting ABOUT them)
- Using community-specific jargon, slang, coded language, or insider terminology
- Making bold, controversial, or unsubstantiated claims
- Emotionally charged: angry, mocking, dismissive, inflammatory, or sensationalist
- Hot takes, rants, teardowns, and harsh critiques
Score LOWER for neutral, balanced, or promotional mainstream coverage. The user wants raw unfiltered opinions and fringe takes, not polished journalism.`;
        effectiveInstructions = effectiveInstructions
          ? `${adversarialPreamble}\n\n${effectiveInstructions}`
          : adversarialPreamble;
      }

      const { scored: itemsScored, clusters } = await this.scoringService.scoreAndCluster(
        (phase, detail) => {
          this.gateway.emitClusteringProgress({
            phase,
            itemsProcessed: 0,
            totalItems: unscoredCount,
          });
          this.logger.log(`Curation progress: [${phase}] ${detail}`);
        },
        effectiveInstructions,
        scoringTarget,
        searchQuery,
        () => this.curateCancelled,
      );

      if (this.curateCancelled) {
        this.logger.log('Curation cancelled after scoring');
        this.gateway.emitCurateCancelled();
        this.gateway.emitFeedUpdated();
        return;
      }

      // Store clusters
      this.store.setClusters(clusters);
      let finalClusters = clusters;

      // === Step 3: Expansion (generate terms + fetch + classify) — skip if targeting specific stores or cancelled ===
      if (!storeIds?.length && !this.curateCancelled) {
        const expansionTerms = await this.generateExpansionTerms();

        if (expansionTerms.length > 0 && !this.curateCancelled) {
          this.logger.log(`Curation step 2/2 — expansion: ${expansionTerms.length} terms...`);

          const expansionItems = await this.fetchExpansionItems(expansionTerms);

          if (expansionItems > 0 && !this.curateCancelled) {
            this.logger.log(`Classifying ${expansionItems} expansion items...`);

            const expansionResult = await this.scoringService.classifyExpansionItems(
              finalClusters,
              (phase, detail) => {
                this.gateway.emitClusteringProgress({
                  phase,
                  itemsProcessed: 0,
                  totalItems: this.store.getItemCount(),
                });
              },
              customInstructions,
              undefined,
              () => this.curateCancelled,
            );

            finalClusters = expansionResult.clusters;
            this.store.setClusters(finalClusters);
          }
        }
      }

      if (this.curateCancelled) {
        this.logger.log('Curation cancelled');
        this.gateway.emitCurateCancelled();
        this.gateway.emitFeedUpdated();
        return;
      }

      const duration = Date.now() - startTime;
      this.gateway.emitCurateComplete({
        itemsScored,
        clustersCreated: finalClusters.length,
        duration,
      });
      this.gateway.emitFeedUpdated();

      this.logger.log(`Curation complete: ${itemsScored} scored, ${finalClusters.length} clusters (${duration}ms)`);
    } catch (err) {
      this.logger.error(`Curation failed: ${(err as Error).message}`);
    } finally {
      this.isCurating = false;
      this.curateCancelled = false;
    }
  }

  private async generateExpansionTerms(): Promise<{ term: string; cluster: string; rationale: string }[]> {
    const config = this.configService.getConfig();
    const scoredItems = this.store.getScoredItems();

    if (scoredItems.length === 0) return [];

    const aiConfig: AIProviderConfig = {
      provider: config.scoring.aiProvider,
      model: config.scoring.aiModel,
      apiKey: config.scoring.aiProvider === 'claude'
        ? config.scoring.claudeApiKey
        : config.scoring.openaiApiKey,
      ollamaEndpoint: config.scoring.ollamaEndpoint,
    };

    // Build a lightweight expansion prompt from scored items directly
    // (no need to wait for clusters — top-scored items give enough context)
    const topItems = [...scoredItems]
      .sort((a, b) => b.aiScore - a.aiScore)
      .slice(0, 30);

    const pseudoClusters = this.groupItemsByTags(topItems);

    const prompt = this.expansionPromptService.buildExpansionPrompt(
      pseudoClusters, scoredItems, config.subjects, config.figures,
    );

    try {
      const response = await this.aiProvider.generateText(prompt, aiConfig, 4096);
      const terms = this.parseExpansionResponse(response.text);
      this.logger.log(`AI suggested ${terms.length} expansion terms`);
      for (const t of terms) {
        this.logger.log(`  Expansion: "${t.term}" (${t.cluster}) — ${t.rationale}`);
      }
      return terms;
    } catch (err) {
      this.logger.error(`Expansion term generation failed: ${(err as Error).message}`);
      return [];
    }
  }

  /** Group top items by their first tag to create pseudo-clusters for the expansion prompt */
  private groupItemsByTags(items: import('../../../shared/types').ScoredItem[]): import('../../../shared/types').StoryCluster[] {
    const groups = new Map<string, import('../../../shared/types').ScoredItem[]>();
    for (const item of items) {
      const tag = item.aiTags[0] || 'misc';
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push(item);
    }
    return Array.from(groups.entries()).map(([tag, groupItems]) => ({
      id: tag,
      title: tag.replace(/_/g, ' '),
      summary: groupItems.map((i) => i.aiSummary || i.title).slice(0, 2).join('; '),
      score: Math.max(...groupItems.map((i) => i.aiScore)),
      subjects: [tag],
      itemIds: groupItems.map((i) => i.id),
      createdAt: new Date().toISOString(),
    }));
  }

  private async fetchExpansionItems(searchTerms: { term: string; cluster: string; rationale: string }[]): Promise<number> {
    const config = this.configService.getConfig();
    const sources = config.sources;

    const syntheticSubjects: SubjectProfile[] = searchTerms.map((t, i) => ({
      id: `expansion_${i}`,
      label: t.term,
      color: '#888888',
      keywords: [t.term],
      enabled: true,
      priority: 5,
    }));

    const relevanceKeywords = this.buildRelevanceKeywords(config, searchTerms.map((t) => t.term));

    const seenUrls = this.store.getSeenUrls();
    const maxAge = config.settings.maxItemAgeDays;
    const cutoff = new Date(Date.now() - maxAge * 24 * 60 * 60 * 1000);
    let totalInserted = 0;

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
    if (sources.substackDiscovery?.enabled) {
      discoveryTasks.push({ name: 'substack-discovery', platform: 'web', source: this.substackDiscoverySource });
    }
    if (sources.twitterDiscovery?.enabled) {
      discoveryTasks.push({ name: 'twitter-discovery', platform: 'twitter', source: this.twitterDiscoverySource });
    }

    if (discoveryTasks.length === 0) return 0;

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

          const freshNew = limited.filter((item) => {
            if (seenUrls.has(item.url)) return false;
            if (item.publishedAt && new Date(item.publishedAt) < cutoff) return false;
            return true;
          });

          // Relevance filter: check title, selftext, subreddit, and URL for
          // keyword overlap. Reddit titles are often vague/clickbait, so we
          // check all available text before dropping an item.
          const relevant = freshNew.filter((item) => {
            const haystack = [
              item.title,
              item.textContent,
              item.url,
              item.sourceAccount,
              (item.metadata as any)?.subreddit,
            ].filter(Boolean).join(' ').toLowerCase();
            const words = haystack.split(/[\s/\-_.,;:!?()]+/);
            return words.some((w) => w.length >= 4 && relevanceKeywords.has(w));
          });

          if (relevant.length < freshNew.length) {
            this.logger.log(`Expansion ${task.name}: filtered ${freshNew.length - relevant.length} irrelevant items`);
          }

          const contentItems: ContentItem[] = relevant.map((raw) => ({
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

          const inserted = this.store.addItems(contentItems as any, undefined);
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
    const parsed = safeJsonParse<any>(text, this.logger);

    if (!parsed || !Array.isArray(parsed)) {
      this.logger.warn('Expansion response parse failed or not an array');
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
  }

  async suggestSearchTerms(topics: string[], figures: string[]): Promise<{ terms: string[] }> {
    const config = this.configService.getConfig();
    const aiConfig: AIProviderConfig = {
      provider: config.scoring.aiProvider,
      model: config.scoring.aiModel,
      apiKey: config.scoring.aiProvider === 'claude'
        ? config.scoring.claudeApiKey
        : config.scoring.openaiApiKey,
      ollamaEndpoint: config.scoring.ollamaEndpoint,
    };

    const topicList = topics.map((t) => `"${t}"`).join(', ');
    const figureList = figures.map((f) => `"${f}"`).join(', ');

    const prompt = `You are helping a content creator find primary source content about specific topics.

Topics: ${topicList || '(none)'}
People/Figures: ${figureList || '(none)'}

IMPORTANT: Each term you generate will be used as a STANDALONE search query sent individually to Reddit, Google News, TikTok, etc. A generic term like "artemis" would return mainstream news — useless. Every term must be specific enough ON ITS OWN to return relevant niche content.

Generate 8-10 search terms. Each should be 2-5 words and self-contained. Good examples:
- "flat earth artemis hoax" (cross-references topics, specific)
- "Kandiss Taylor flat earth" (figure + topic together)
- "artemis moon landing conspiracy" (topic + specific angle)

Bad examples:
- "artemis" (too generic, returns mainstream news)
- "moon landing" (too broad without context)
- "conspiracy theories" (meaningless on its own)

Focus on:
- Cross-referencing topics with figures (e.g. "figure name + topic")
- Specific claims, events, or controversies
- Community names, influencer names, or niche terminology
- Terms that narrow results to the specific angle the user cares about

Return ONLY a JSON array of strings.`;

    try {
      const response = await this.aiProvider.generateText(prompt, aiConfig, 2048);
      const terms = safeJsonParse<string[]>(response.text, this.logger);
      if (Array.isArray(terms)) {
        const filtered = terms.filter((t) => typeof t === 'string').slice(0, 10);
        this.logger.log(`AI suggested ${filtered.length} search terms for topics=[${topics.join(', ')}] figures=[${figures.join(', ')}]`);
        return { terms: filtered };
      }
    } catch (err) {
      this.logger.error(`Search term suggestion failed: ${(err as Error).message}`);
    }
    return { terms: [] };
  }

  async triggerAdvancedSearch(terms: string[], videoOnly = false, adversarial = false, maxAgeDays?: number): Promise<{ message: string }> {
    if (this.isSearching) throw new Error('Search already in progress');
    if (this.isCurating) throw new Error('Cannot search while curation is in progress');

    this.isSearching = true;
    this.searchCancelled = false;

    const query = terms.join(' | ');
    const searchStore = this.store.createStore(`Search: ${query}`, 'search', terms);

    this.gateway.emitQuickSearchStarted({
      query,
      timestamp: new Date().toISOString(),
    });

    this.runSearchWithTerms(terms, query, videoOnly, adversarial, maxAgeDays, searchStore.id).catch((err) => {
      this.logger.error(`Advanced search failed: ${err.message}`);
    });

    return { message: 'Advanced search started' };
  }

  async triggerQuickSearch(query: string, aiExpand = false, videoOnly = false, adversarial = false, maxAgeDays?: number): Promise<{ message: string }> {
    if (this.isSearching) throw new Error('Search already in progress');
    if (this.isCurating) throw new Error('Cannot search while curation is in progress');

    this.isSearching = true;
    this.searchCancelled = false;

    const searchStore = this.store.createStore(`Search: ${query}`, 'search', [query]);

    this.gateway.emitQuickSearchStarted({
      query,
      timestamp: new Date().toISOString(),
    });

    this.runQuickSearch(query, aiExpand, videoOnly, adversarial, maxAgeDays, searchStore.id).catch((err) => {
      this.logger.error(`Quick search failed: ${err.message}`);
    });

    return { message: 'Quick search started' };
  }

  private async runQuickSearch(query: string, aiExpand: boolean, videoOnly = false, adversarial = false, maxAgeDays?: number, storeId?: string): Promise<void> {
    let searchTerms = [query];

    if (aiExpand) {
      const expanded = await this.generateQuickSearchExpansion(query);
      if (expanded.length > 0) {
        searchTerms = [query, ...expanded];
      }
    }

    if (adversarial) {
      const adversarialTerms = await this.generateAdversarialTerms(query);
      searchTerms.push(...adversarialTerms);
    }

    return this.runSearchWithTerms(searchTerms, query, videoOnly, adversarial, maxAgeDays, storeId);
  }

  private async runSearchWithTerms(searchTerms: string[], query: string, videoOnly = false, adversarial = false, maxAgeDays?: number, storeId?: string): Promise<void> {
    const startTime = Date.now();

    try {
      // Pass query through as-is — Google News RSS and Reddit both support
      // standard search operators natively ("quotes" for phrase, -word to exclude).
      const syntheticSubjects: SubjectProfile[] = searchTerms.map((term, i) => ({
        id: `quicksearch_${i}`,
        label: term,
        color: '#888888',
        keywords: [term],
        enabled: true,
        priority: 5,
      }));

      const sourceConfig = { enabled: true, subjects: syntheticSubjects, figures: [], videoOnly };

      // Build discovery source list — skip text-only sources in video mode
      const discoveryTasks: { name: string; platform: string; source: BaseSource }[] = [];
      if (!videoOnly) {
        discoveryTasks.push({ name: 'google-news', platform: 'web', source: this.googleNewsSource });
      }
      discoveryTasks.push({ name: 'reddit', platform: 'reddit', source: this.redditSearchSource });
      discoveryTasks.push({ name: 'tiktok', platform: 'tiktok', source: this.tiktokDiscoverySource });
      discoveryTasks.push({ name: 'instagram', platform: 'instagram', source: this.instagramDiscoverySource });
      if (!videoOnly) {
        discoveryTasks.push({ name: 'substack', platform: 'web', source: this.substackDiscoverySource });
      }
      discoveryTasks.push({ name: 'twitter', platform: 'twitter', source: this.twitterDiscoverySource });
      if (videoOnly) {
        discoveryTasks.push({ name: 'youtube-shorts', platform: 'youtube', source: this.youtubeShortsDiscoverySource });
      }

      let totalInserted = 0;
      let completedCount = 0;

      const results = await Promise.allSettled(
        discoveryTasks.map(async (task) => {
          try {
            const rawItems = await task.source.fetch(sourceConfig);
            const limited = rawItems.slice(0, 50);

            // Video-only mode: keep only video content (twitter exempt — can't detect video)
            const videoFiltered = (videoOnly && task.platform !== 'twitter')
              ? limited.filter((item) => item.contentType === 'video')
              : limited;

            // Date filter
            const filtered = maxAgeDays
              ? videoFiltered.filter((item) => {
                  if (!item.publishedAt) return true;
                  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
                  return new Date(item.publishedAt) >= cutoff;
                })
              : videoFiltered;

            const contentItems: ContentItem[] = filtered.map((raw) => ({
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

            const inserted = this.store.addItems(contentItems as any, storeId, true);
            completedCount++;

            this.gateway.emitQuickSearchProgress({
              source: task.name,
              platform: task.platform,
              status: 'complete',
              itemsFound: filtered.length,
              current: completedCount,
              total: discoveryTasks.length,
            });

            this.logger.log(`QuickSearch ${task.name}: found ${limited.length}, kept ${filtered.length}, inserted ${inserted} new`);
            return inserted;
          } catch (err) {
            completedCount++;
            this.gateway.emitQuickSearchProgress({
              source: task.name,
              platform: task.platform,
              status: 'error',
              itemsFound: 0,
              current: completedCount,
              total: discoveryTasks.length,
            });
            this.logger.warn(`QuickSearch ${task.name} failed: ${(err as Error).message}`);
            return 0;
          }
        }),
      );

      for (const r of results) {
        if (r.status === 'fulfilled') totalInserted += r.value;
      }

      if (this.searchCancelled) {
        this.logger.log('Quick search cancelled');
        this.gateway.emitQuickSearchCancelled();
        this.gateway.emitFeedUpdated();
        return;
      }

      const duration = Date.now() - startTime;
      const store = storeId ? this.store.getStore(storeId) : undefined;
      this.gateway.emitQuickSearchComplete({
        query,
        itemsFound: totalInserted,
        duration,
        storeId,
        storeName: store?.name,
      });

      this.logger.log(`Quick search complete: "${query}" — ${totalInserted} items (${duration}ms)`);
    } catch (err) {
      this.logger.error(`Quick search failed: ${(err as Error).message}`);
    } finally {
      this.isSearching = false;
      this.searchCancelled = false;
    }
  }

  private async generateQuickSearchExpansion(query: string): Promise<string[]> {
    try {
      const config = this.configService.getConfig();
      const aiConfig: AIProviderConfig = {
        provider: config.scoring.aiProvider,
        model: config.scoring.aiModel,
        apiKey: config.scoring.aiProvider === 'claude'
          ? config.scoring.claudeApiKey
          : config.scoring.openaiApiKey,
        ollamaEndpoint: config.scoring.ollamaEndpoint,
      };

      const prompt = `You are a search term expansion assistant. Given a search query, generate 5-8 additional search terms that would find relevant recent news, social media posts, and video clips.

Query: "${query}"

IMPORTANT: Each term will be used as a STANDALONE search query on Reddit, TikTok, Google News, etc. Every term must be specific enough on its own to return relevant results — don't generate vague single-word terms that would match unrelated content.

Each term should be 2-5 words. Return a JSON array of strings, nothing else.`;

      const response = await this.aiProvider.generateText(prompt, aiConfig, 1024);
      const terms = safeJsonParse<string[]>(response.text, this.logger);
      if (Array.isArray(terms)) {
        this.logger.log(`AI expanded "${query}" into ${terms.length} additional terms`);
        return terms.filter((t) => typeof t === 'string').slice(0, 8);
      }
    } catch (err) {
      this.logger.warn(`Quick search expansion failed: ${(err as Error).message}`);
    }
    return [];
  }

  private async generateAdversarialTerms(context: string): Promise<string[]> {
    try {
      const config = this.configService.getConfig();
      const aiConfig: AIProviderConfig = {
        provider: config.scoring.aiProvider,
        model: config.scoring.aiModel,
        apiKey: config.scoring.aiProvider === 'claude'
          ? config.scoring.claudeApiKey
          : config.scoring.openaiApiKey,
        ollamaEndpoint: config.scoring.ollamaEndpoint,
      };

      const prompt = `You are a search term generator that finds contrarian, critical, hostile, and fringe perspectives on any topic. The user wants raw unfiltered opinions — not mainstream coverage, but the actual critics, skeptics, haters, and fringe communities.

Given this topic/context:
"${context}"

IMPORTANT: Each term you generate will be used as a STANDALONE search query sent individually to Reddit, TikTok, Google News, etc. A vague term like "conspiracy" or "artemis" will return mainstream results — useless. Every term must be specific enough ON ITS OWN to surface the fringe/adversarial content.

Generate 8-12 search terms. Each should be 2-5 words and self-contained. Good examples:
- "firmament nasa lies" (insider language + specific target)
- "flat earth artemis fake" (cross-references topics, adversarial angle)
- "anti-vax measles exposed" (contrarian framing, specific topic)

Bad examples:
- "conspiracy" (generic, matches everything)
- "artemis" (returns mainstream launch coverage)
- "skeptics" (meaningless without topic context)

Think about:
- Insider jargon and coded language believers/critics actually use
- Specific claims phrased the way the community phrases them
- Names of vocal critics, contrarian figures, or fringe influencers + the topic
- Subreddit or community names where critical discussion happens
- For political/conspiracy: dog whistles and terms from within the community
- For products/tech: specific complaints, failure terms, hater slang + the product name
- For science: alternative theory terminology + the mainstream topic they reject

Return ONLY a JSON array of search term strings.`;

      const response = await this.aiProvider.generateText(prompt, aiConfig, 1024);
      const terms = safeJsonParse<string[]>(response.text, this.logger);
      if (Array.isArray(terms)) {
        const filtered = terms.filter((t) => typeof t === 'string').slice(0, 12);
        this.logger.log(`Adversarial mode generated ${filtered.length} terms: ${filtered.join(', ')}`);
        return filtered;
      }
    } catch (err) {
      this.logger.warn(`Adversarial term generation failed: ${(err as Error).message}`);
    }
    return [];
  }

  async triggerScan(videoOnly = false, adversarial = false, maxAgeDays?: number, searchTerms?: string[]): Promise<{ message: string }> {
    if (this.isScanning) throw new Error('Scan already in progress');
    if (this.isCurating) throw new Error('Cannot scan while curation is in progress');

    this.isScanning = true;
    this.scanCancelled = false;
    const startTime = Date.now();

    const dateLabel = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const resolvedTerms = searchTerms ?? this.resolveProfileTerms();
    const scanStore = this.store.createStore(`Scan ${dateLabel}`, 'scan', resolvedTerms);

    this.gateway.emitScanStarted({
      scanId: Date.now().toString(),
      timestamp: new Date().toISOString(),
    });

    this.runScan(startTime, videoOnly, adversarial, maxAgeDays, scanStore.id, searchTerms).catch((err) => {
      this.logger.error(`Scan failed: ${err.message}`);
    });

    return { message: 'Scan started' };
  }

  private resolveProfileTerms(): string[] {
    const config = this.configService.getConfig();
    const topics = config.subjects.filter((s: SubjectProfile) => s.enabled).map((s: SubjectProfile) => s.label);
    const figures = config.figures.map((f: any) => f.name);
    return [...topics, ...figures];
  }

  private async runScan(startTime: number, videoOnly = false, adversarial = false, maxAgeDays?: number, storeId?: string, overrideTerms?: string[]): Promise<void> {
    // Reload config from the active profile so source changes are picked up
    this.configService.reloadActiveProfile();

    // Auto-resolve any YouTube channel names to IDs before scanning
    await this.resolveUnresolvedYouTubeChannels();

    const config = this.configService.getConfig();
    const errors: any[] = [];
    let totalFound = 0;
    let totalNew = 0;

    try {
      const tasks = this.buildSourceTasks(config, videoOnly, overrideTerms);

      // Adversarial mode: generate extra discovery tasks with AI-generated fringe terms
      if (adversarial) {
        const contextParts: string[] = [];
        for (const s of config.subjects) {
          if (s.enabled) contextParts.push(`${s.label}: ${s.keywords.join(', ')}`);
        }
        for (const f of config.figures) {
          contextParts.push(`Figure: ${f.name} (${f.tier})`);
        }
        const adversarialTerms = await this.generateAdversarialTerms(contextParts.join('\n'));

        if (adversarialTerms.length > 0) {
          const adversarialSubjects: SubjectProfile[] = adversarialTerms.map((term, i) => ({
            id: `adversarial_${i}`,
            label: term,
            color: '#888888',
            keywords: [term],
            enabled: true,
            priority: 5,
          }));

          const adversarialConfig = { enabled: true, subjects: adversarialSubjects, figures: [], videoOnly };

          // Add one task per discovery source type with adversarial subjects
          const discoveryMappings: { name: string; platform: string; source: BaseSource; skipVideoOnly?: boolean }[] = [
            { name: 'adversarial-google-news', platform: 'web', source: this.googleNewsSource, skipVideoOnly: true },
            { name: 'adversarial-reddit-search', platform: 'reddit', source: this.redditSearchSource },
            { name: 'adversarial-tiktok', platform: 'tiktok', source: this.tiktokDiscoverySource },
            { name: 'adversarial-instagram', platform: 'web', source: this.instagramDiscoverySource },
            { name: 'adversarial-substack', platform: 'web', source: this.substackDiscoverySource, skipVideoOnly: true },
            { name: 'adversarial-twitter', platform: 'twitter', source: this.twitterDiscoverySource },
          ];

          for (const mapping of discoveryMappings) {
            if (videoOnly && mapping.skipVideoOnly) continue;
            tasks.push({
              name: mapping.name,
              platform: mapping.platform,
              source: mapping.source,
              config: adversarialConfig,
            });
          }

          this.logger.log(`Adversarial mode: added ${adversarialTerms.length} terms across discovery sources`);
        }
      }

      const seenUrls = this.store.getSeenUrls();
      const maxAge = maxAgeDays ?? config.settings.maxItemAgeDays;
      const cutoff = new Date(Date.now() - maxAge * 24 * 60 * 60 * 1000);
      let completedCount = 0;

      // Build relevance keywords for discovery sources (global search results need filtering)
      const relevanceKeywords = this.buildRelevanceKeywords(config);

      // Run all sources in parallel
      this.gateway.emitScanProgress({
        source: 'all',
        platform: 'all',
        status: 'fetching',
        itemsFound: 0,
        current: 0,
        total: tasks.length,
      });

      const results = await Promise.allSettled(
        tasks.map(async (task) => {
          try {
            const rawItems = await task.source.fetch(task.config);
            const limited = rawItems.slice(0, config.settings.maxResultsPerSource);
            const newRawItems = limited.filter((item) => !seenUrls.has(item.url));
            const freshItems = newRawItems.filter((item) => {
              if (!item.publishedAt) return true;
              return new Date(item.publishedAt) >= cutoff;
            });

            // Discovery sources (global search) need relevance filtering to avoid noise.
            // Account/feed-based sources (reddit, twitter, youtube, web-rss) are already scoped.
            const discoveryNames = ['reddit-search', 'google-news', 'tiktok-discovery', 'instagram-discovery', 'substack-discovery', 'twitter-discovery'];
            const needsRelevanceFilter = discoveryNames.includes(task.name);
            const filtered = needsRelevanceFilter
              ? freshItems.filter((item) => {
                  const haystack = [
                    item.title,
                    item.textContent,
                    item.url,
                    item.sourceAccount,
                    (item.metadata as any)?.subreddit,
                  ].filter(Boolean).join(' ').toLowerCase();
                  const words = haystack.split(/[\s/\-_.,;:!?()]+/);
                  return words.some((w) => w.length >= 3 && relevanceKeywords.has(w));
                })
              : freshItems;

            if (needsRelevanceFilter && filtered.length < freshItems.length) {
              this.logger.log(`${task.name}: filtered ${freshItems.length - filtered.length} irrelevant items`);
            }

            // Video-only mode: keep only video content (twitter exempt — can't detect video)
            const finalFiltered = (videoOnly && task.platform !== 'twitter')
              ? filtered.filter((item) => item.contentType === 'video')
              : filtered;

            const contentItems: ContentItem[] = finalFiltered.map((raw) => ({
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

            const inserted = this.store.addItems(contentItems as any, storeId);
            completedCount++;

            this.gateway.emitScanProgress({
              source: task.name,
              platform: task.platform,
              status: 'complete',
              itemsFound: limited.length,
              current: completedCount,
              total: tasks.length,
            });

            this.logger.log(`${task.name}: found ${limited.length}, inserted ${inserted} new`);

            // Check for dead sources
            const dead = task.source.getAndClearDeadSources();
            if (dead.length > 0) {
              this.removeDeadSources(dead);
            }

            return { found: limited.length, inserted };
          } catch (err) {
            const message = (err as Error).message;
            completedCount++;

            this.gateway.emitScanProgress({
              source: task.name,
              platform: task.platform,
              status: 'error',
              itemsFound: 0,
              current: completedCount,
              total: tasks.length,
            });

            this.logger.warn(`${task.name} error: ${message}`);
            errors.push({ source: task.name, platform: task.platform, error: message });
            return { found: 0, inserted: 0 };
          }
        }),
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          totalFound += r.value.found;
          totalNew += r.value.inserted;
        }
      }

      if (this.scanCancelled) {
        this.logger.log('Scan cancelled');
        this.gateway.emitScanCancelled();
        this.gateway.emitFeedUpdated();
        return;
      }

      const duration = Date.now() - startTime;

      const scanStoreObj = storeId ? this.store.getStore(storeId) : undefined;
      this.gateway.emitScanComplete({
        itemsFound: totalFound,
        newItems: totalNew,
        errors,
        duration,
        storeId,
        storeName: scanStoreObj?.name,
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
      this.scanCancelled = false;
    }
  }

  private buildSourceTasks(config: any, videoOnly = false, overrideTerms?: string[]): SourceTask[] {
    const tasks: SourceTask[] = [];
    const sources = config.sources;

    // When overrideTerms are provided, create synthetic subjects for discovery sources
    const discoverySubjects = overrideTerms
      ? overrideTerms.map((term, i) => ({
          id: `custom_${i}`,
          label: term,
          color: '#888888',
          keywords: [term],
          enabled: true,
          priority: 5,
        }))
      : config.subjects;
    const discoveryFigures = overrideTerms ? [] : config.figures;

    // Feed sources — always use profile config (unaffected by overrideTerms)
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

    if (sources.webRss?.enabled && !videoOnly) {
      tasks.push({
        name: 'web-rss',
        platform: 'web',
        source: this.webRssSource,
        config: sources.webRss,
      });
    }

    // Discovery sources — use overrideTerms when provided
    if (sources.redditSearch?.enabled) {
      tasks.push({
        name: 'reddit-search',
        platform: 'reddit',
        source: this.redditSearchSource,
        config: { ...sources.redditSearch, subjects: discoverySubjects, figures: discoveryFigures, videoOnly },
      });
    }

    if (sources.googleNews?.enabled && !videoOnly) {
      tasks.push({
        name: 'google-news',
        platform: 'web',
        source: this.googleNewsSource,
        config: { ...sources.googleNews, subjects: discoverySubjects, figures: discoveryFigures },
      });
    }

    if (sources.tiktokDiscovery?.enabled) {
      tasks.push({
        name: 'tiktok-discovery',
        platform: 'tiktok',
        source: this.tiktokDiscoverySource,
        config: { ...sources.tiktokDiscovery, subjects: discoverySubjects, figures: discoveryFigures },
      });
    }

    if (sources.instagramDiscovery?.enabled) {
      tasks.push({
        name: 'instagram-discovery',
        platform: 'web',
        source: this.instagramDiscoverySource,
        config: { ...sources.instagramDiscovery, subjects: discoverySubjects, figures: discoveryFigures },
      });
    }

    if (sources.substackDiscovery?.enabled && !videoOnly) {
      tasks.push({
        name: 'substack-discovery',
        platform: 'web',
        source: this.substackDiscoverySource,
        config: { ...sources.substackDiscovery, subjects: discoverySubjects, figures: discoveryFigures },
      });
    }

    if (sources.twitterDiscovery?.enabled) {
      tasks.push({
        name: 'twitter-discovery',
        platform: 'twitter',
        source: this.twitterDiscoverySource,
        config: { ...sources.twitterDiscovery, subjects: discoverySubjects, figures: discoveryFigures },
      });
    }

    // YouTube Shorts discovery — only in video mode
    if (videoOnly) {
      tasks.push({
        name: 'youtube-shorts',
        platform: 'youtube',
        source: this.youtubeShortsDiscoverySource,
        config: { enabled: true, subjects: discoverySubjects, figures: discoveryFigures },
      });
    }

    return tasks;
  }

  private async resolveUnresolvedYouTubeChannels(): Promise<void> {
    const activeId = this.profileService.getActiveProfileId();
    if (!activeId) return;

    const ytSources = this.profileService.getSources(activeId, 'youtube');
    const unresolved = ytSources.filter((s) => !s.value.startsWith('UC'));

    if (unresolved.length === 0) return;

    this.logger.log(`Resolving ${unresolved.length} unresolved YouTube channel IDs...`);
    let resolved = 0;

    for (const source of unresolved) {
      try {
        const result = await this.sourceDiscovery.resolveYouTubeChannelId(source.value);
        if (result.valid && result.resolvedValue) {
          this.profileService.updateSourceValue(activeId, source.id, result.resolvedValue);
          this.logger.log(`Resolved YouTube "${source.name}" → ${result.resolvedValue}`);
          resolved++;
        } else {
          this.logger.warn(`Could not resolve YouTube "${source.name}": ${result.reason}`);
          // Remove sources that can't be resolved
          this.profileService.removeSource(activeId, source.id);
          this.logger.warn(`Removed unresolvable YouTube source: ${source.name}`);
        }
      } catch (err) {
        this.logger.warn(`YouTube resolve error for "${source.name}": ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (resolved > 0) {
      this.configService.reloadActiveProfile();
      this.logger.log(`Resolved ${resolved}/${unresolved.length} YouTube channels`);
    }
  }

  private removeDeadSources(dead: import('./sources/base-source').DeadSource[]): void {
    const activeId = this.profileService.getActiveProfileId();
    if (!activeId) return;

    const profileSources = this.profileService.getSources(activeId);

    for (const d of dead) {
      const match = profileSources.find(
        (s) => s.platform === d.platform && s.sourceType === d.sourceType && s.value === d.value,
      );
      if (match) {
        this.logger.warn(`Removing dead source: ${d.platform}/${d.value} — ${d.reason}`);
        this.profileService.removeSource(activeId, match.id);
      }
    }

    if (dead.length > 0) {
      this.configService.reloadActiveProfile();
    }
  }

  /** Build a set of relevance keywords from profile subjects, figures, and optional extra terms.
   *  Used to pre-filter garbage from discovery sources that do global search. */
  private buildRelevanceKeywords(config: any, extraTerms?: string[]): Set<string> {
    const keywords = new Set<string>();

    for (const s of config.subjects) {
      // Add subject label words
      for (const word of s.label.toLowerCase().split(/\s+/)) {
        if (word.length >= 3) keywords.add(word);
      }
      // Add explicit keywords
      for (const kw of s.keywords) {
        for (const word of kw.toLowerCase().split(/\s+/)) {
          if (word.length >= 3) keywords.add(word);
        }
      }
    }

    for (const f of config.figures) {
      // Add each name part (e.g. "Richard Dawkins" → "richard", "dawkins")
      for (const word of f.name.toLowerCase().split(/\s+/)) {
        if (word.length >= 3) keywords.add(word);
      }
    }

    if (extraTerms) {
      for (const term of extraTerms) {
        for (const word of term.toLowerCase().split(/\s+/)) {
          if (word.length >= 3) keywords.add(word);
        }
      }
    }

    // Remove very common words that would match anything
    const stopWords = ['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has', 'was', 'one', 'our', 'out', 'new', 'from', 'with', 'this', 'that', 'they', 'will', 'than', 'been', 'have', 'what', 'when', 'who', 'how'];
    for (const sw of stopWords) keywords.delete(sw);

    return keywords;
  }
}
