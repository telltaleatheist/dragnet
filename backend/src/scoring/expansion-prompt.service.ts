import { Injectable } from '@nestjs/common';
import { StoryCluster, ScoredItem, SubjectProfile, FigureProfile } from '../../../shared/types';
import { EXPANSION_SYSTEM, EXPANSION_RESPONSE_FORMAT } from './prompts';

@Injectable()
export class ExpansionPromptService {
  buildExpansionPrompt(
    clusters: StoryCluster[],
    scoredItems: ScoredItem[],
    subjects: SubjectProfile[],
    figures: FigureProfile[],
  ): string {
    // Build a lookup for quick item access
    const itemMap = new Map(scoredItems.map((i) => [i.id, i]));

    // Render top clusters (sorted by score, take top 15)
    const topClusters = [...clusters]
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    const clusterBlocks = topClusters.map((cluster) => {
      const items = cluster.itemIds
        .map((id) => itemMap.get(id))
        .filter(Boolean)
        .slice(0, 3);

      const itemLines = items
        .map((item) => `    - "${item!.title}" (${item!.platform}, score ${item!.aiScore})`)
        .join('\n');

      return `CLUSTER: ${cluster.title} (score: ${cluster.score})
  Summary: ${cluster.summary}
  Subjects: ${cluster.subjects.join(', ') || 'none'}
  Top items:
${itemLines}`;
    }).join('\n\n');

    // List existing terms so AI doesn't repeat them
    const existingTerms = [
      ...subjects.filter((s) => s.enabled).map((s) => s.label),
      ...figures.map((f) => f.name),
    ];

    return `${EXPANSION_SYSTEM}

EXISTING SUBJECT LABELS (do not repeat these):
${existingTerms.map((t) => `- ${t}`).join('\n')}

STORY CLUSTERS TO EXPAND (${topClusters.length} of ${clusters.length}):

${clusterBlocks}

${EXPANSION_RESPONSE_FORMAT}`;
  }
}
