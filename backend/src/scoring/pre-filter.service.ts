import { Injectable, Logger } from '@nestjs/common';
import { DragnetConfigService } from '../config/dragnet-config.service';
import { StoredItem } from '../database/items.service';

export interface PreFilterResult {
  score: number;
  matchedKeywords: string[];
  matchedFigures: string[];
  matchedSubjects: string[];
}

@Injectable()
export class PreFilterService {
  private readonly logger = new Logger(PreFilterService.name);

  constructor(private readonly configService: DragnetConfigService) {}

  /**
   * Quick local scoring based on keyword/figure matching.
   * Returns a score 0-10 indicating how relevant an item likely is.
   */
  scoreItem(item: StoredItem): PreFilterResult {
    const config = this.configService.getConfig();
    const searchText = [
      item.title,
      item.text_content,
      item.author,
      item.source_account,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const matchedKeywords: string[] = [];
    const matchedSubjects: string[] = [];
    const matchedFigures: string[] = [];
    let score = 0;

    // Check subjects/keywords
    for (const subject of config.subjects) {
      if (!subject.enabled) continue;
      for (const keyword of subject.keywords) {
        if (searchText.includes(keyword.toLowerCase())) {
          matchedKeywords.push(keyword);
          if (!matchedSubjects.includes(subject.id)) {
            matchedSubjects.push(subject.id);
          }
          // Higher priority subjects score more
          score += subject.priority === 1 ? 2 : 1;
        }
      }
    }

    // Check figures
    for (const figure of config.figures) {
      const nameMatch = searchText.includes(figure.name.toLowerCase());
      const aliasMatch = figure.aliases.some((a) =>
        searchText.includes(a.toLowerCase()),
      );
      if (nameMatch || aliasMatch) {
        matchedFigures.push(figure.name);
        // Tier-based scoring
        const boost = config.scoring.weights.figureBoosts[figure.tier] || 1;
        score += boost;
      }
    }

    // Video content boost
    if (item.content_type === 'video') {
      score *= config.scoring.weights.videoBoost;
    }

    // Recency boost (newer items score higher)
    if (item.published_at) {
      const ageHours = (Date.now() - new Date(item.published_at).getTime()) / 3600000;
      const decayDays = config.scoring.weights.recencyDecayDays;
      const recencyFactor = Math.max(0, 1 - ageHours / (decayDays * 24));
      score *= 0.5 + 0.5 * recencyFactor; // 50% base + 50% recency
    }

    // Cap at 10
    score = Math.min(Math.round(score * 10) / 10, 10);

    return { score, matchedKeywords, matchedFigures, matchedSubjects };
  }

  /**
   * Filter items that are worth sending to AI for scoring.
   * Returns items with pre-filter score > 0 (matched at least one keyword/figure).
   */
  filterForAI(items: StoredItem[]): StoredItem[] {
    return items.filter((item) => {
      // Skip already scored items
      if (item.scored_at) return false;
      // Score must be > 0 to go to AI
      const result = this.scoreItem(item);
      return result.score > 0;
    });
  }
}
