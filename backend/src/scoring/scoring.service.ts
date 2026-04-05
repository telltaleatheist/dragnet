import { Injectable, Logger } from '@nestjs/common';
import { InMemoryStoreService } from '../store/in-memory-store.service';
import { DragnetConfigService } from '../config/dragnet-config.service';
import { AIProviderService, AIProviderConfig, AIResponse } from './ai-provider.service';
import { PreFilterService } from './pre-filter.service';
import { ScoringPromptService } from './scoring-prompt.service';
import { ScoredItem, StoryCluster } from '../../../shared/types';
import { safeJsonParse } from './json-parse';
import { v4 as uuidv4 } from 'uuid';

/** Max items per triage call. Output is just IDs so we can handle large batches. */
const TRIAGE_BATCH_SIZE = 300;

/** Max items per classify call. Output includes scores + clusters. */
const CLASSIFY_BATCH_SIZE = 150;

/** Max items per expansion classify call. Smaller than classify since prompt also includes existing clusters. */
const EXPANSION_BATCH_SIZE = 100;

export type ScoringProgressCallback = (phase: string, detail: string) => void;

/** Abstraction over which item collection the scoring pipeline operates on. */
export interface ScoringTarget {
  getUnscoredItems(): ScoredItem[];
  updatePreFilterScore(id: string, score: number): void;
  updateAIScore(id: string, score: number, tags: string[], summary: string, clipType?: string, reasoning?: string, provider?: string, model?: string): void;
  getItem(id: string): ScoredItem | undefined;
}

interface ClassifyResult {
  items: Array<{
    id: string;
    score: number;
    summary: string;
    clip_type?: string;
    tags: string[];
  }>;
  clusters: Array<{
    title: string;
    summary: string;
    subjects: string[];
    itemIds: string[];
  }>;
}

interface ExpansionClassifyResult {
  items: Array<{
    id: string;
    score: number;
    summary: string;
    clip_type?: string;
    tags: string[];
  }>;
  assignments: Array<{
    itemId: string;
    clusterTitle: string;
  }>;
  newClusters: Array<{
    title: string;
    summary: string;
    subjects: string[];
    itemIds: string[];
  }>;
}

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    private readonly store: InMemoryStoreService,
    private readonly configService: DragnetConfigService,
    private readonly aiProvider: AIProviderService,
    private readonly preFilter: PreFilterService,
    private readonly promptService: ScoringPromptService,
  ) {}

  /**
   * Full pipeline: triage → classify → produces scored items + clusters.
   * Returns the number of items scored.
   */
  async scoreAndCluster(
    onProgress?: ScoringProgressCallback,
    customInstructions?: string,
    target?: ScoringTarget,
    searchQuery?: string,
    isCancelled?: () => boolean,
  ): Promise<{ scored: number; clusters: StoryCluster[] }> {
    const t = target || this.defaultTarget();
    const config = this.configService.getConfig();
    const unscored = t.getUnscoredItems();

    if (unscored.length === 0) {
      this.logger.log('No unscored items to process');
      return { scored: 0, clusters: [] };
    }

    const aiConfig: AIProviderConfig = {
      provider: config.scoring.aiProvider,
      model: config.scoring.aiModel,
      apiKey: config.scoring.aiProvider === 'claude'
        ? config.scoring.claudeApiKey
        : config.scoring.openaiApiKey,
      ollamaEndpoint: config.scoring.ollamaEndpoint,
    };

    // Step 1: Pre-filter (fast, no AI) — still useful as a keyword boost
    this.logger.log(`Pre-filtering ${unscored.length} items...`);
    for (const item of unscored) {
      const result = this.preFilter.scoreItem(item);
      t.updatePreFilterScore(item.id, result.score);
    }

    // Pre-load Ollama model with a consistent context size to avoid reloads between batches
    if (aiConfig.provider === 'ollama') {
      // Classify is the biggest call: prompt can be large + 32k output tokens
      // Use 65536 as a safe ceiling for all requests in this session
      await this.aiProvider.preloadOllamaModel(aiConfig, 65536);
    }

    // Step 2: AI Triage — send all titles, get back IDs of interesting items
    onProgress?.('triage', `Triaging ${unscored.length} items...`);
    this.logger.log(`Triaging ${unscored.length} items...`);

    const interestingIds = await this.triageItems(unscored, aiConfig, customInstructions, searchQuery, isCancelled);

    if (isCancelled?.()) {
      this.logger.log('Scoring cancelled after triage');
      return { scored: 0, clusters: [] };
    }

    if (interestingIds.size === 0) {
      this.logger.log('No items passed AI triage');
      // Mark all as scored with score=1
      for (const item of unscored) {
        t.updateAIScore(item.id, 1, [], '', 'background', undefined, aiConfig.provider, aiConfig.model);
      }
      return { scored: unscored.length, clusters: [] };
    }

    // Mark non-interesting items as scored with score=1
    for (const item of unscored) {
      if (!interestingIds.has(item.id)) {
        t.updateAIScore(item.id, 1, [], '', 'background', undefined, aiConfig.provider, aiConfig.model);
      }
    }

    const interesting = unscored.filter((item) => interestingIds.has(item.id));
    this.logger.log(`${interesting.length}/${unscored.length} items passed triage`);

    // Step 3: AI Classify — score + cluster interesting items
    onProgress?.('classify', `Classifying ${interesting.length} items...`);
    this.logger.log(`Classifying ${interesting.length} items...`);

    const { scored, clusters } = await this.classifyItems(interesting, aiConfig, t, customInstructions, searchQuery, isCancelled);

    this.logger.log(`Classification complete: ${scored} items scored, ${clusters.length} clusters`);
    return { scored: scored + (unscored.length - interesting.length), clusters };
  }

  /**
   * Classify expansion items against existing clusters.
   * Batched in parallel like classifyItems. Returns scored count and updated cluster list.
   */
  async classifyExpansionItems(
    existingClusters: StoryCluster[],
    onProgress?: ScoringProgressCallback,
    customInstructions?: string,
    target?: ScoringTarget,
    isCancelled?: () => boolean,
  ): Promise<{ scored: number; clusters: StoryCluster[] }> {
    const t = target || this.defaultTarget();
    const config = this.configService.getConfig();
    const unscored = t.getUnscoredItems();

    if (unscored.length === 0) {
      return { scored: 0, clusters: existingClusters };
    }

    const aiConfig: AIProviderConfig = {
      provider: config.scoring.aiProvider,
      model: config.scoring.aiModel,
      apiKey: config.scoring.aiProvider === 'claude'
        ? config.scoring.claudeApiKey
        : config.scoring.openaiApiKey,
      ollamaEndpoint: config.scoring.ollamaEndpoint,
    };

    // Pre-filter expansion items
    for (const item of unscored) {
      const result = this.preFilter.scoreItem(item);
      t.updatePreFilterScore(item.id, result.score);
    }

    onProgress?.('classify-expansion', `Classifying ${unscored.length} expansion items...`);
    this.logger.log(`Classifying ${unscored.length} expansion items against ${existingClusters.length} clusters...`);

    // Batch expansion items (use smaller batch since we also include cluster context)
    const batches = this.chunk(unscored, EXPANSION_BATCH_SIZE);
    let totalScored = 0;
    const allAssignments: ExpansionClassifyResult['assignments'] = [];
    const allNewClusters: ExpansionClassifyResult['newClusters'] = [];
    const processedIds = new Set<string>();

    const processBatch = async (batch: ScoredItem[]) => {
      const prompt = this.promptService.buildExpansionClassifyPrompt(batch, existingClusters, customInstructions);
      const maxTokens = 16000;
      const response = await this.aiProvider.generateText(prompt, aiConfig, maxTokens);
      return { parsed: this.parseExpansionClassifyResponse(response.text, batch), response, batch };
    };

    const applyResult = (result: { parsed: ExpansionClassifyResult; response: AIResponse; batch: ScoredItem[] }) => {
      const { parsed, response, batch } = result;
      for (const item of parsed.items) {
        t.updateAIScore(
          item.id, item.score, item.tags, item.summary,
          item.clip_type, undefined, response.provider, response.model,
        );
        totalScored++;
      }
      for (const item of batch) {
        processedIds.add(item.id);
        if (!parsed.items.find((r) => r.id === item.id)) {
          t.updateAIScore(item.id, 1, [], '', 'background', undefined, aiConfig.provider, aiConfig.model);
          totalScored++;
        }
      }
      allAssignments.push(...parsed.assignments);
      allNewClusters.push(...parsed.newClusters);
    };

    if (aiConfig.provider === 'ollama') {
      for (const batch of batches) {
        if (isCancelled?.()) break;
        try {
          applyResult(await processBatch(batch));
        } catch (err) {
          this.logger.error(`Expansion classify batch failed: ${(err as Error).message}`);
        }
      }
    } else {
      if (!isCancelled?.()) {
        const results = await Promise.allSettled(batches.map(processBatch));
        for (const result of results) {
          if (result.status === 'fulfilled') {
            applyResult(result.value);
          } else {
            this.logger.error(`Expansion classify batch failed: ${result.reason?.message || result.reason}`);
          }
        }
      }
    }

    for (const item of unscored) {
      if (!processedIds.has(item.id)) {
        t.updateAIScore(item.id, 1, [], '', 'background', undefined, aiConfig.provider, aiConfig.model);
        totalScored++;
      }
    }

    // Apply cluster assignments and new clusters
    const mergedResult: ExpansionClassifyResult = {
      items: [],
      assignments: allAssignments,
      newClusters: allNewClusters,
    };
    const updatedClusters = this.applyExpansionClusters(existingClusters, mergedResult, t);

    this.logger.log(`Expansion classification: ${totalScored} scored, ${allAssignments.length} assigned to existing clusters, ${allNewClusters.length} new clusters`);
    return { scored: totalScored, clusters: updatedClusters };
  }

  /** Default target: reads/writes the main item collection. */
  private defaultTarget(): ScoringTarget {
    return {
      getUnscoredItems: () => this.store.getUnscoredItems(),
      updatePreFilterScore: (id, score) => this.store.updatePreFilterScore(id, score),
      updateAIScore: (id, score, tags, summary, clipType?, reasoning?, provider?, model?) =>
        this.store.updateAIScore(id, score, tags, summary, clipType, reasoning, provider, model),
      getItem: (id) => this.store.getItem(id),
    };
  }

  /** Target scoped to specific data stores, optionally filtering by max age. */
  targetForStores(storeIds?: string[], maxAgeDays?: number): ScoringTarget {
    const base = storeIds?.length ? storeIds : undefined;
    const defaultGet = base
      ? () => this.store.getUnscoredItems(base)
      : () => this.store.getUnscoredItems();

    const getUnscoredItems = maxAgeDays
      ? () => {
          const cutoff = Date.now() - maxAgeDays * 86_400_000;
          const all = defaultGet();
          const fresh: ScoredItem[] = [];
          for (const item of all) {
            const date = item.publishedAt || item.fetchedAt;
            if (new Date(date).getTime() >= cutoff) {
              fresh.push(item);
            } else {
              // Mark old items as score=1 immediately
              this.store.updateAIScore(item.id, 1, [], '', 'background', 'filtered by maxAgeDays');
            }
          }
          return fresh;
        }
      : defaultGet;

    return {
      getUnscoredItems,
      updatePreFilterScore: (id, score) => this.store.updatePreFilterScore(id, score),
      updateAIScore: (id, score, tags, summary, clipType?, reasoning?, provider?, model?) =>
        this.store.updateAIScore(id, score, tags, summary, clipType, reasoning, provider, model),
      getItem: (id) => this.store.getItem(id),
    };
  }

  // --- Private pipeline methods ---

  private async triageItems(
    items: ScoredItem[],
    aiConfig: AIProviderConfig,
    customInstructions?: string,
    searchQuery?: string,
    isCancelled?: () => boolean,
  ): Promise<Set<string>> {
    const batches = this.chunk(items, TRIAGE_BATCH_SIZE);
    const allInteresting = new Set<string>();

    const processBatch = async (batch: ScoredItem[]) => {
      const prompt = this.promptService.buildTriagePrompt(batch, customInstructions, searchQuery);
      const maxTokens = 16000;
      const response = await this.aiProvider.generateText(prompt, aiConfig, maxTokens);
      return this.parseTriageResponse(response.text, batch);
    };

    // Ollama: run sequentially (single-threaded, avoids reload thrashing)
    // Cloud: run in parallel
    if (aiConfig.provider === 'ollama') {
      for (const batch of batches) {
        if (isCancelled?.()) break;
        try {
          const ids = await processBatch(batch);
          for (const id of ids) allInteresting.add(id);
        } catch (err) {
          this.logger.error(`Triage batch failed: ${(err as Error).message}`);
          for (const item of batch) allInteresting.add(item.id);
        }
      }
    } else {
      if (isCancelled?.()) return allInteresting;
      const results = await Promise.allSettled(batches.map(processBatch));
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
          for (const id of result.value) allInteresting.add(id);
        } else {
          this.logger.error(`Triage batch failed: ${result.reason?.message || result.reason}`);
          for (const item of batches[i]) allInteresting.add(item.id);
        }
      }
    }

    return allInteresting;
  }

  private async classifyItems(
    items: ScoredItem[],
    aiConfig: AIProviderConfig,
    target: ScoringTarget,
    customInstructions?: string,
    searchQuery?: string,
    isCancelled?: () => boolean,
  ): Promise<{ scored: number; clusters: StoryCluster[] }> {
    // Sort by title so similar items land in the same batch
    const sorted = [...items].sort((a, b) => a.title.localeCompare(b.title));
    const batches = this.chunk(sorted, CLASSIFY_BATCH_SIZE);
    let totalScored = 0;
    const allClusters: StoryCluster[] = [];

    const processBatch = async (batch: ScoredItem[]) => {
      const prompt = this.promptService.buildClassifyPrompt(batch, customInstructions, searchQuery);
      const maxTokens = 32000;
      const response = await this.aiProvider.generateText(prompt, aiConfig, maxTokens);
      return { parsed: this.parseClassifyResponse(response.text, batch), response };
    };

    const applyResult = (result: { parsed: ClassifyResult; response: AIResponse }) => {
      const { parsed, response } = result;
      for (const item of parsed.items) {
        target.updateAIScore(
          item.id, item.score, item.tags, item.summary,
          item.clip_type, undefined, response.provider, response.model,
        );
        totalScored++;
      }
      for (const cluster of parsed.clusters) {
        allClusters.push({
          id: uuidv4(),
          title: cluster.title,
          summary: cluster.summary,
          subjects: cluster.subjects,
          itemIds: cluster.itemIds,
          score: 0,
          createdAt: new Date().toISOString(),
        });
      }
    };

    // Ollama: run sequentially (single-threaded, avoids reload thrashing)
    // Cloud: run in parallel
    if (aiConfig.provider === 'ollama') {
      for (const batch of batches) {
        if (isCancelled?.()) break;
        try {
          applyResult(await processBatch(batch));
        } catch (err) {
          this.logger.error(`Classify batch failed: ${(err as Error).message}`);
        }
      }
    } else {
      if (!isCancelled?.()) {
        const results = await Promise.allSettled(batches.map(processBatch));
        for (const result of results) {
          if (result.status === 'fulfilled') {
            applyResult(result.value);
          } else {
            this.logger.error(`Classify batch failed: ${result.reason?.message || result.reason}`);
          }
        }
      }
    }

    // Merge duplicate clusters across batches (title similarity)
    const deduped = this.deduplicateClusters(allClusters);

    // Compute cluster scores (average of member item scores)
    for (const cluster of deduped) {
      const memberItems = cluster.itemIds
        .map((id) => target.getItem(id))
        .filter(Boolean) as ScoredItem[];
      if (memberItems.length > 0) {
        cluster.score = Math.round(
          memberItems.reduce((sum, i) => sum + i.aiScore, 0) / memberItems.length,
        );
      }
    }

    // Sort clusters by score descending
    deduped.sort((a, b) => b.score - a.score);

    return { scored: totalScored, clusters: deduped };
  }

  // --- Response parsers (use safeJsonParse for resilience with smaller models) ---

  private parseTriageResponse(text: string, items: ScoredItem[]): string[] {
    const parsed = safeJsonParse<any>(text, this.logger);

    if (!parsed || !Array.isArray(parsed)) {
      this.logger.warn('Triage parse failed or not an array — failing open (include all items)');
      return items.map((i) => i.id);
    }

    const validIds = new Set(items.map((i) => i.id));
    return parsed.filter((id: any) => typeof id === 'string' && validIds.has(id));
  }

  private parseClassifyResponse(text: string, items: ScoredItem[]): ClassifyResult {
    const parsed = safeJsonParse<any>(text, this.logger);

    if (!parsed) {
      this.logger.error('Classify parse failed');
      return { items: [], clusters: [] };
    }

    const validIds = new Set(items.map((i) => i.id));

    const scoredItems = (parsed.items || []).filter((r: any) => {
      if (!r.id || !validIds.has(r.id)) return false;
      if (typeof r.score !== 'number' || r.score < 1 || r.score > 10) return false;
      return true;
    }).map((r: any) => ({
      id: r.id,
      score: Math.round(r.score),
      tags: Array.isArray(r.tags) ? r.tags : [],
      summary: r.summary || '',
      clip_type: r.clip_type,
    }));

    const clusters = (parsed.clusters || []).filter((c: any) => {
      if (!c.title || !Array.isArray(c.itemIds)) return false;
      c.itemIds = c.itemIds.filter((id: string) => validIds.has(id));
      return c.itemIds.length > 0;
    }).map((c: any) => ({
      title: c.title,
      summary: c.summary || '',
      subjects: Array.isArray(c.subjects) ? c.subjects : [],
      itemIds: c.itemIds,
    }));

    return { items: scoredItems, clusters };
  }

  private parseExpansionClassifyResponse(text: string, items: ScoredItem[]): ExpansionClassifyResult {
    const parsed = safeJsonParse<any>(text, this.logger);

    if (!parsed) {
      this.logger.error('Expansion classify parse failed');
      return { items: [], assignments: [], newClusters: [] };
    }

    const validIds = new Set(items.map((i) => i.id));

    const scoredItems = (parsed.items || []).filter((r: any) => {
      if (!r.id || !validIds.has(r.id)) return false;
      if (typeof r.score !== 'number' || r.score < 1 || r.score > 10) return false;
      return true;
    }).map((r: any) => ({
      id: r.id,
      score: Math.round(r.score),
      tags: Array.isArray(r.tags) ? r.tags : [],
      summary: r.summary || '',
      clip_type: r.clip_type,
    }));

    const assignments = (parsed.assignments || []).filter((a: any) =>
      a.itemId && validIds.has(a.itemId) && a.clusterTitle,
    );

    const newClusters = (parsed.newClusters || []).filter((c: any) => {
      if (!c.title || !Array.isArray(c.itemIds)) return false;
      c.itemIds = c.itemIds.filter((id: string) => validIds.has(id));
      return c.itemIds.length > 0;
    }).map((c: any) => ({
      title: c.title,
      summary: c.summary || '',
      subjects: Array.isArray(c.subjects) ? c.subjects : [],
      itemIds: c.itemIds,
    }));

    return { items: scoredItems, assignments, newClusters };
  }

  private applyExpansionClusters(
    existing: StoryCluster[],
    result: ExpansionClassifyResult,
    target?: ScoringTarget,
  ): StoryCluster[] {
    const t = target || this.defaultTarget();
    const clusters = [...existing];

    // Apply assignments (match by title)
    for (const assignment of result.assignments) {
      const cluster = clusters.find((c) =>
        c.title.toLowerCase() === assignment.clusterTitle.toLowerCase(),
      );
      if (cluster && !cluster.itemIds.includes(assignment.itemId)) {
        cluster.itemIds.push(assignment.itemId);
      }
    }

    // Add new clusters
    for (const nc of result.newClusters) {
      clusters.push({
        id: uuidv4(),
        title: nc.title,
        summary: nc.summary,
        subjects: nc.subjects,
        itemIds: nc.itemIds,
        score: 0,
        createdAt: new Date().toISOString(),
      });
    }

    // Recompute scores
    for (const cluster of clusters) {
      const memberItems = cluster.itemIds
        .map((id) => t.getItem(id))
        .filter(Boolean) as ScoredItem[];
      if (memberItems.length > 0) {
        cluster.score = Math.round(
          memberItems.reduce((sum, i) => sum + i.aiScore, 0) / memberItems.length,
        );
      }
    }

    clusters.sort((a, b) => b.score - a.score);
    return clusters;
  }

  // --- Utility ---

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  private static readonly STOP_WORDS = new Set([
    'the', 'a', 'an', 'in', 'on', 'at', 'for', 'to', 'of', 'and', 'or',
    'is', 'are', 'was', 'were', 'by', 'from', 'with', 'says', 'said',
    'after', 'about', 'how', 'that', 'this', 'his', 'her', 'their', 'its',
    'not', 'but', 'has', 'had', 'have', 'who', 'new', 'over', 'into',
    'will', 'been', 'more', 'than', 'out', 'can', 'could', 'would',
  ]);

  private titleWords(title: string): Set<string> {
    return new Set(
      title.toLowerCase()
        .split(/[\s\-—:,.'"/()[\]]+/)
        .filter((w) => w.length >= 3 && !ScoringService.STOP_WORDS.has(w)),
    );
  }

  /**
   * Merge clusters with highly similar titles (Jaccard > 0.35 on significant words).
   * Catches the common case where the same story appears in multiple classify batches.
   */
  private deduplicateClusters(clusters: StoryCluster[]): StoryCluster[] {
    if (clusters.length <= 1) return clusters;

    const wordSets = clusters.map((c) => this.titleWords(c.title));
    const absorbed = new Set<number>();
    const result: StoryCluster[] = [];

    for (let i = 0; i < clusters.length; i++) {
      if (absorbed.has(i)) continue;

      const merged: StoryCluster = {
        ...clusters[i],
        itemIds: [...clusters[i].itemIds],
        subjects: [...clusters[i].subjects],
      };

      for (let j = i + 1; j < clusters.length; j++) {
        if (absorbed.has(j)) continue;

        // Jaccard similarity on significant title words
        let intersection = 0;
        for (const w of wordSets[i]) {
          if (wordSets[j].has(w)) intersection++;
        }
        const union = wordSets[i].size + wordSets[j].size - intersection;
        const jaccard = union === 0 ? 0 : intersection / union;

        if (jaccard >= 0.35) {
          merged.itemIds.push(...clusters[j].itemIds);
          for (const s of clusters[j].subjects) {
            if (!merged.subjects.includes(s)) merged.subjects.push(s);
          }
          absorbed.add(j);
        }
      }

      // Deduplicate item IDs
      merged.itemIds = [...new Set(merged.itemIds)];
      result.push(merged);
    }

    if (absorbed.size > 0) {
      this.logger.log(`Cluster dedup: merged ${absorbed.size} duplicate clusters, ${result.length} remain`);
    }

    return result;
  }
}
