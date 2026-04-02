import { Injectable, Logger } from '@nestjs/common';
import { ItemsService, StoredItem } from '../database/items.service';
import { DragnetConfigService } from '../config/dragnet-config.service';
import { AIProviderService, AIProviderConfig } from './ai-provider.service';
import { PreFilterService } from './pre-filter.service';
import { ScoringPromptService } from './scoring-prompt.service';

interface ScoringResult {
  id: string;
  score: number;
  tags: string[];
  summary: string;
  clip_type?: string;
  reasoning?: string;
}

export type ScoringProgressCallback = (batch: number, totalBatches: number, itemsScored: number) => void;

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    private readonly itemsService: ItemsService,
    private readonly configService: DragnetConfigService,
    private readonly aiProvider: AIProviderService,
    private readonly preFilter: PreFilterService,
    private readonly promptService: ScoringPromptService,
  ) {}

  /**
   * Run pre-filter scoring on all unscored items, then AI-score the top candidates.
   * Returns the number of items scored by AI.
   */
  async scoreNewItems(onProgress?: ScoringProgressCallback): Promise<number> {
    const config = this.configService.getConfig();

    // Get all unscored items
    const { items: allItems } = this.itemsService.queryFeed({
      page: 1,
      limit: 500,
    });

    const unscored = allItems.filter((item) => !item.scored_at);
    if (unscored.length === 0) {
      this.logger.log('No unscored items to process');
      return 0;
    }

    // Step 1: Pre-filter scoring
    this.logger.log(`Pre-filtering ${unscored.length} items...`);
    for (const item of unscored) {
      const result = this.preFilter.scoreItem(item);
      this.itemsService.updatePreFilterScore(item.id, result.score);
    }

    // Step 2: Select items worth AI scoring (pre_filter_score > 0)
    const candidates = unscored.filter((item) => {
      const result = this.preFilter.scoreItem(item);
      return result.score > 0;
    });

    if (candidates.length === 0) {
      this.logger.log('No items passed pre-filter for AI scoring');
      return 0;
    }

    this.logger.log(`${candidates.length} items passed pre-filter, sending to AI...`);

    // Step 3: Batch AI scoring
    const batchSize = config.scoring.batchSize;
    const batches = this.chunk(candidates, batchSize);
    let totalScored = 0;

    const aiConfig: AIProviderConfig = {
      provider: config.scoring.aiProvider,
      model: config.scoring.aiModel,
      apiKey: config.scoring.aiProvider === 'claude'
        ? config.scoring.claudeApiKey
        : config.scoring.openaiApiKey,
      ollamaEndpoint: config.scoring.ollamaEndpoint,
    };

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      onProgress?.(i + 1, batches.length, totalScored);

      try {
        const scored = await this.scoreBatch(batch, aiConfig);
        totalScored += scored;
      } catch (err) {
        this.logger.error(`Batch ${i + 1} scoring failed: ${(err as Error).message}`);
      }
    }

    this.logger.log(`AI scoring complete: ${totalScored}/${candidates.length} items scored`);
    return totalScored;
  }

  private async scoreBatch(items: StoredItem[], aiConfig: AIProviderConfig): Promise<number> {
    const prompt = this.promptService.buildBatchPrompt(items);

    const response = await this.aiProvider.generateText(prompt, aiConfig);
    const results = this.parseAIResponse(response.text, items);

    let scored = 0;
    for (const result of results) {
      try {
        this.itemsService.updateScore(
          result.id,
          result.score,
          result.tags,
          result.summary,
          result.clip_type,
          result.reasoning,
          response.provider,
          response.model,
        );
        scored++;
      } catch (err) {
        this.logger.warn(`Failed to save score for ${result.id}: ${(err as Error).message}`);
      }
    }

    return scored;
  }

  private parseAIResponse(text: string, items: StoredItem[]): ScoringResult[] {
    try {
      let jsonStr = text.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) {
        this.logger.warn('AI response is not an array');
        return [];
      }

      const validIds = new Set(items.map((i) => i.id));
      return parsed.filter((r: any) => {
        if (!r.id || !validIds.has(r.id)) return false;
        if (typeof r.score !== 'number' || r.score < 1 || r.score > 10) return false;
        return true;
      }).map((r: any) => ({
        id: r.id,
        score: Math.round(r.score),
        tags: Array.isArray(r.tags) ? r.tags : [],
        summary: r.summary || '',
        clip_type: r.clip_type,
        reasoning: r.reasoning,
      }));
    } catch (err) {
      this.logger.error(`Failed to parse AI response: ${(err as Error).message}`);
      this.logger.debug(`Raw AI response: ${text.slice(0, 500)}`);
      return [];
    }
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
