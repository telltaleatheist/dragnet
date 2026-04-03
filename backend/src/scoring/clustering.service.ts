import { Injectable, Logger } from '@nestjs/common';
import { InMemoryStoreService } from '../store/in-memory-store.service';
import { DragnetConfigService } from '../config/dragnet-config.service';
import { AIProviderService, AIProviderConfig } from './ai-provider.service';
import { ClusteringPromptService } from './clustering-prompt.service';
import { StoryCluster } from '../../../shared/types';
import { v4 as uuidv4 } from 'uuid';

export type ClusteringProgressCallback = (itemsProcessed: number, totalItems: number) => void;

@Injectable()
export class ClusteringService {
  private readonly logger = new Logger(ClusteringService.name);

  constructor(
    private readonly store: InMemoryStoreService,
    private readonly configService: DragnetConfigService,
    private readonly aiProvider: AIProviderService,
    private readonly promptService: ClusteringPromptService,
  ) {}

  async clusterScoredItems(onProgress?: ClusteringProgressCallback): Promise<number> {
    const scored = this.store.getScoredItems();
    if (scored.length === 0) {
      this.logger.log('No scored items to cluster');
      this.store.setClusters([]);
      return 0;
    }

    onProgress?.(0, scored.length);

    const config = this.configService.getConfig();
    const aiConfig: AIProviderConfig = {
      provider: config.scoring.aiProvider,
      model: config.scoring.aiModel,
      apiKey: config.scoring.aiProvider === 'claude'
        ? config.scoring.claudeApiKey
        : config.scoring.openaiApiKey,
      ollamaEndpoint: config.scoring.ollamaEndpoint,
    };

    try {
      const prompt = this.promptService.buildClusteringPrompt(scored);
      const response = await this.aiProvider.generateText(prompt, aiConfig, 16384);
      const clusters = this.parseClusterResponse(response.text, scored);

      this.store.setClusters(clusters);
      onProgress?.(scored.length, scored.length);

      this.logger.log(`Clustering complete: ${clusters.length} clusters from ${scored.length} items`);
      return clusters.length;
    } catch (err) {
      this.logger.error(`Clustering failed: ${(err as Error).message} — creating fallback cluster`);
      const fallback = this.createFallbackCluster(scored);
      this.store.setClusters([fallback]);
      return 1;
    }
  }

  private parseClusterResponse(text: string, items: import('../../../shared/types').ScoredItem[]): StoryCluster[] {
    try {
      let jsonStr = text.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);
      if (!parsed.clusters || !Array.isArray(parsed.clusters)) {
        this.logger.warn('AI clustering response missing clusters array');
        return [this.createFallbackCluster(items)];
      }

      const validIds = new Set(items.map((i) => i.id));

      return parsed.clusters
        .filter((c: any) => c.title && Array.isArray(c.itemIds) && c.itemIds.length > 0)
        .map((c: any) => {
          const validItemIds = c.itemIds.filter((id: string) => validIds.has(id));
          if (validItemIds.length === 0) return null;

          const clusterItems = validItemIds.map((id: string) => items.find((i) => i.id === id)!);
          const maxScore = Math.max(...clusterItems.map((i: any) => i.aiScore));

          return {
            id: uuidv4(),
            title: c.title,
            summary: c.summary || '',
            score: maxScore,
            subjects: Array.isArray(c.subjects) ? c.subjects : [],
            itemIds: validItemIds,
            createdAt: new Date().toISOString(),
          } as StoryCluster;
        })
        .filter(Boolean) as StoryCluster[];
    } catch (err) {
      this.logger.error(`Failed to parse clustering response: ${(err as Error).message}`);
      this.logger.debug(`Raw response: ${text.slice(0, 500)}`);
      return [this.createFallbackCluster(items)];
    }
  }

  async mergeNewItems(onProgress?: ClusteringProgressCallback): Promise<number> {
    const existingClusters = this.store.getClusters();
    const allScored = this.store.getScoredItems();

    // Find items not in any existing cluster
    const clusteredIds = new Set(existingClusters.flatMap((c) => c.itemIds));
    const newItems = allScored.filter((i) => !clusteredIds.has(i.id));

    if (newItems.length === 0) {
      this.logger.log('No new items to merge into clusters');
      return existingClusters.length;
    }

    this.logger.log(`Merging ${newItems.length} new items into ${existingClusters.length} existing clusters`);
    onProgress?.(0, newItems.length);

    const config = this.configService.getConfig();
    const aiConfig: AIProviderConfig = {
      provider: config.scoring.aiProvider,
      model: config.scoring.aiModel,
      apiKey: config.scoring.aiProvider === 'claude'
        ? config.scoring.claudeApiKey
        : config.scoring.openaiApiKey,
      ollamaEndpoint: config.scoring.ollamaEndpoint,
    };

    try {
      const prompt = this.promptService.buildMergePrompt(existingClusters, newItems);
      const response = await this.aiProvider.generateText(prompt, aiConfig, 16384);
      const updatedClusters = this.parseMergeResponse(response.text, existingClusters, newItems);

      this.store.setClusters(updatedClusters);
      onProgress?.(newItems.length, newItems.length);

      const newClusterCount = updatedClusters.length - existingClusters.length;
      this.logger.log(
        `Merged ${newItems.length} new items into ${existingClusters.length} existing clusters, created ${Math.max(0, newClusterCount)} new`,
      );
      return updatedClusters.length;
    } catch (err) {
      this.logger.error(`Merge clustering failed: ${(err as Error).message} — falling back to append`);
      // Fallback: put all new items into a single new cluster
      const fallback: StoryCluster = {
        id: uuidv4(),
        title: 'Expansion Items',
        summary: `${newItems.length} items from expansion search.`,
        score: newItems.length > 0 ? Math.max(...newItems.map((i) => i.aiScore)) : 0,
        subjects: [],
        itemIds: newItems.map((i) => i.id),
        createdAt: new Date().toISOString(),
      };
      this.store.setClusters([...existingClusters, fallback]);
      return existingClusters.length + 1;
    }
  }

  private parseMergeResponse(
    text: string,
    existingClusters: StoryCluster[],
    newItems: import('../../../shared/types').ScoredItem[],
  ): StoryCluster[] {
    try {
      let jsonStr = text.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);
      const clusterMap = new Map(existingClusters.map((c) => [c.id, { ...c, itemIds: [...c.itemIds] }]));
      const validNewIds = new Set(newItems.map((i) => i.id));
      const allScored = this.store.getScoredItems();
      const scoreLookup = new Map(allScored.map((i) => [i.id, i.aiScore]));

      // Apply assignments
      if (Array.isArray(parsed.assignments)) {
        for (const a of parsed.assignments) {
          const cluster = clusterMap.get(a.clusterId);
          if (cluster && validNewIds.has(a.itemId)) {
            cluster.itemIds.push(a.itemId);
            // Update cluster score if new item scores higher
            const itemScore = scoreLookup.get(a.itemId) || 0;
            if (itemScore > cluster.score) cluster.score = itemScore;
          }
        }
      }

      // Apply merges (absorb mergeClusterIds into targetClusterId)
      if (Array.isArray(parsed.merges)) {
        for (const m of parsed.merges) {
          const target = clusterMap.get(m.targetClusterId);
          if (!target) continue;
          for (const mergeId of m.mergeClusterIds || []) {
            const source = clusterMap.get(mergeId);
            if (!source) continue;
            target.itemIds.push(...source.itemIds);
            if (source.score > target.score) target.score = source.score;
            clusterMap.delete(mergeId);
          }
        }
      }

      // Create new clusters
      const results = Array.from(clusterMap.values());
      if (Array.isArray(parsed.newClusters)) {
        for (const nc of parsed.newClusters) {
          if (!nc.title || !Array.isArray(nc.itemIds) || nc.itemIds.length === 0) continue;
          const validIds = nc.itemIds.filter((id: string) => validNewIds.has(id));
          if (validIds.length === 0) continue;
          const maxScore = Math.max(...validIds.map((id: string) => scoreLookup.get(id) || 0));
          results.push({
            id: uuidv4(),
            title: nc.title,
            summary: nc.summary || '',
            score: maxScore,
            subjects: Array.isArray(nc.subjects) ? nc.subjects : [],
            itemIds: validIds,
            createdAt: new Date().toISOString(),
          });
        }
      }

      return results;
    } catch (err) {
      this.logger.error(`Failed to parse merge response: ${(err as Error).message}`);
      this.logger.debug(`Raw merge response: ${text.slice(0, 500)}`);
      // Return existing clusters unchanged + fallback for new items
      const fallback: StoryCluster = {
        id: uuidv4(),
        title: 'Expansion Items',
        summary: `${newItems.length} items from expansion search.`,
        score: newItems.length > 0 ? Math.max(...newItems.map((i) => i.aiScore)) : 0,
        subjects: [],
        itemIds: newItems.map((i) => i.id),
        createdAt: new Date().toISOString(),
      };
      return [...existingClusters, fallback];
    }
  }

  private createFallbackCluster(items: import('../../../shared/types').ScoredItem[]): StoryCluster {
    const maxScore = items.length > 0 ? Math.max(...items.map((i) => i.aiScore)) : 0;
    return {
      id: uuidv4(),
      title: 'All Scored Items',
      summary: `${items.length} items scored by AI, grouped together.`,
      score: maxScore,
      subjects: [],
      itemIds: items.map((i) => i.id),
      createdAt: new Date().toISOString(),
    };
  }
}
