import { Injectable } from '@nestjs/common';
import { DragnetConfigService } from '../config/dragnet-config.service';
import { ScoredItem } from '../../../shared/types';
import {
  SCORING_SYSTEM,
  SCORING_HIGH,
  SCORING_MEDIUM,
  SCORING_LOW,
  SCORING_CLIP_TYPES,
  SCORING_RESPONSE_FORMAT,
} from './prompts';

@Injectable()
export class ScoringPromptService {
  constructor(private readonly configService: DragnetConfigService) {}

  buildBatchPrompt(items: ScoredItem[], customInstructions?: string): string {
    const config = this.configService.getConfig();

    const subjectDescriptions = config.subjects
      .filter((s) => s.enabled)
      .map((s) => `- "${s.id}": ${s.label} (keywords: ${s.keywords.slice(0, 5).join(', ')}...)`)
      .join('\n');

    const figureNames = config.figures
      .slice(0, 30)
      .map((f) => `${f.name} (${f.tier}, subjects: ${f.subjects.join(', ')})`)
      .join(', ');

    const itemBlocks = items.map((item, i) => {
      const text = item.textContent
        ? item.textContent.slice(0, 800)
        : '(no text content)';
      return `--- ITEM ${i + 1} (id: ${item.id}) ---
Title: ${item.title}
Author: ${item.author}
Platform: ${item.platform}
Source: ${item.sourceAccount}
Content: ${text}`;
    }).join('\n\n');

    // Use runtime custom instructions, or fall back to config editorialNotes
    const instructions = customInstructions?.trim() || config.scoring.editorialNotes?.trim();
    const instructionsBlock = instructions
      ? `\nCUSTOM SCORING INSTRUCTIONS:\n${instructions}\n`
      : '';

    return `${SCORING_SYSTEM}

SUBJECT AREAS:
${subjectDescriptions}

KEY FIGURES TO WATCH:
${figureNames}

${SCORING_HIGH}

${SCORING_MEDIUM}

${SCORING_LOW}

${SCORING_CLIP_TYPES}
${instructionsBlock}
ITEMS TO SCORE:
${itemBlocks}

${SCORING_RESPONSE_FORMAT}`;
  }
}
