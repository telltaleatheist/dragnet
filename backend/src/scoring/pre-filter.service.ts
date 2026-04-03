import { Injectable, Logger } from '@nestjs/common';
import { DragnetConfigService } from '../config/dragnet-config.service';
import { ScoredItem } from '../../../shared/types';

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

  scoreItem(item: ScoredItem): PreFilterResult {
    const config = this.configService.getConfig();
    const searchText = [
      item.title,
      item.textContent,
      item.author,
      item.sourceAccount,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const matchedKeywords: string[] = [];
    const matchedSubjects: string[] = [];
    const matchedFigures: string[] = [];
    let score = 0;

    for (const subject of config.subjects) {
      if (!subject.enabled) continue;
      for (const keyword of subject.keywords) {
        if (searchText.includes(keyword.toLowerCase())) {
          matchedKeywords.push(keyword);
          if (!matchedSubjects.includes(subject.id)) {
            matchedSubjects.push(subject.id);
          }
          score += subject.priority === 1 ? 2 : 1;
        }
      }
    }

    for (const figure of config.figures) {
      const nameMatch = searchText.includes(figure.name.toLowerCase());
      const aliasMatch = figure.aliases.some((a) =>
        searchText.includes(a.toLowerCase()),
      );
      if (nameMatch || aliasMatch) {
        matchedFigures.push(figure.name);
        const boost = config.scoring.weights.figureBoosts[figure.tier] || 1;
        score += boost;
      }
    }

    if (item.contentType === 'video') {
      score *= config.scoring.weights.videoBoost;
    }

    if (item.publishedAt) {
      const ageHours = (Date.now() - new Date(item.publishedAt).getTime()) / 3600000;
      const decayDays = config.scoring.weights.recencyDecayDays;
      const recencyFactor = Math.max(0, 1 - ageHours / (decayDays * 24));
      score *= 0.5 + 0.5 * recencyFactor;
    }

    score = Math.min(Math.round(score * 10) / 10, 10);

    return { score, matchedKeywords, matchedFigures, matchedSubjects };
  }

  filterForAI(items: ScoredItem[]): ScoredItem[] {
    return items.filter((item) => {
      if (item.scoredAt) return false;
      const result = this.scoreItem(item);
      return result.score > 0;
    });
  }
}
