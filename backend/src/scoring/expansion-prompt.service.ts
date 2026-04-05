import { Injectable } from '@nestjs/common';
import { StoryCluster, ScoredItem, SubjectProfile, FigureProfile } from '../../../shared/types';
import { EXPANSION_SYSTEM, EXPANSION_RESPONSE_FORMAT } from './prompts';

@Injectable()
export class ExpansionPromptService {
  /** Build tiered figure list for expansion context. */
  private buildTieredFigures(figures: FigureProfile[]): string {
    const byTier: Record<string, FigureProfile[]> = {
      top_priority: [],
      high_priority: [],
      monitor: [],
    };

    for (const f of figures) {
      const tier = byTier[f.tier];
      if (tier) tier.push(f);
    }

    const sections: string[] = [];
    if (byTier.top_priority.length) {
      const names = byTier.top_priority.map((f) => `${f.name} [${f.subjects.join(', ')}]`);
      sections.push(`TOP PRIORITY:\n${names.join(', ')}`);
    }
    if (byTier.high_priority.length) {
      const names = byTier.high_priority.map((f) => `${f.name} [${f.subjects.join(', ')}]`);
      sections.push(`HIGH PRIORITY:\n${names.join(', ')}`);
    }
    if (byTier.monitor.length) {
      const names = byTier.monitor.map((f) => f.name);
      sections.push(`MONITOR:\n${names.join(', ')}`);
    }
    return sections.join('\n\n');
  }

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

    // List existing subject labels so AI doesn't repeat them verbatim
    const existingLabels = subjects.filter((s) => s.enabled).map((s) => s.label);

    // Build tiered figure list with subject associations
    const figureList = this.buildTieredFigures(figures);

    return `${EXPANSION_SYSTEM}

TRACKED FIGURES (use these names in search terms when relevant):
${figureList}

EXISTING SUBJECT LABELS (do not repeat these verbatim):
${existingLabels.map((t) => `- ${t}`).join('\n')}

EXPANSION STRATEGY:
- For each high-scoring cluster, suggest at least one search term that includes a specific figure's name + the story topic
- If a cluster involves Figure A, suggest searches for other tracked figures in the same subject area who might have commented on or reacted to the same story
- Suggest terms that will find video clips — include platform-specific phrasing where useful (e.g. "clip", "video", short-form friendly phrases)
- Suggest related figures who would likely comment on the same story, even if not in the tracked list

STORY CLUSTERS TO EXPAND (${topClusters.length} of ${clusters.length}):

${clusterBlocks}

${EXPANSION_RESPONSE_FORMAT}`;
  }
}
