import { Injectable } from '@nestjs/common';
import { ScoredItem, StoryCluster } from '../../../shared/types';
import {
  CLUSTERING_SYSTEM,
  CLUSTERING_WHAT_MAKES,
  CLUSTERING_WHAT_DOES_NOT,
  CLUSTERING_TITLE_RULE,
  CLUSTERING_OTHER_RULES,
  CLUSTERING_RESPONSE_FORMAT,
  MERGE_SYSTEM,
  MERGE_RESPONSE_FORMAT,
} from './prompts';

@Injectable()
export class ClusteringPromptService {
  buildClusteringPrompt(items: ScoredItem[]): string {
    const itemBlocks = items.map((item) => {
      const text = item.platform === 'youtube'
        ? `${item.title} — ${(item.textContent || '').slice(0, 400)}`
        : (item.aiSummary || item.title);
      return `- ID: ${item.id} | Score: ${item.aiScore} | Platform: ${item.platform} | Tags: ${item.aiTags.join(', ')} | "${text}"`;
    }).join('\n');

    return `${CLUSTERING_SYSTEM}

${CLUSTERING_WHAT_MAKES}

${CLUSTERING_WHAT_DOES_NOT}

${CLUSTERING_TITLE_RULE}

${CLUSTERING_OTHER_RULES}

ITEMS (${items.length} total):
${itemBlocks}

${CLUSTERING_RESPONSE_FORMAT}`;
  }

  buildMergePrompt(existingClusters: StoryCluster[], newItems: ScoredItem[]): string {
    const clusterBlocks = existingClusters.map((c) =>
      `- ID: ${c.id} | Title: "${c.title}" | Summary: "${c.summary}" | Subjects: ${c.subjects.join(', ') || 'none'} | Items: ${c.itemIds.length}`,
    ).join('\n');

    const itemBlocks = newItems.map((item) => {
      const text = item.platform === 'youtube'
        ? `${item.title} — ${(item.textContent || '').slice(0, 400)}`
        : (item.aiSummary || item.title);
      return `- ID: ${item.id} | Score: ${item.aiScore} | Platform: ${item.platform} | Tags: ${item.aiTags.join(', ')} | "${text}"`;
    }).join('\n');

    return `${MERGE_SYSTEM}

EXISTING CLUSTERS (${existingClusters.length}):
${clusterBlocks}

NEW ITEMS TO ASSIGN (${newItems.length}):
${itemBlocks}

${MERGE_RESPONSE_FORMAT}`;
  }
}
