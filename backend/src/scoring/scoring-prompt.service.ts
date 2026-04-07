import { Injectable } from '@nestjs/common';
import { DragnetConfigService } from '../config/dragnet-config.service';
import { ScoredItem, StoryCluster } from '../../../shared/types';
import {
  TRIAGE_SYSTEM,
  TRIAGE_RESPONSE_FORMAT,
  CLASSIFY_SYSTEM,
  SCORING_HIGH,
  SCORING_MEDIUM,
  SCORING_LOW,
  SCORING_CLIP_TYPES,
  CLASSIFY_RESPONSE_FORMAT,
  CLASSIFY_EXPANSION_RESPONSE_FORMAT,
  CLUSTERING_WHAT_MAKES,
  CLUSTERING_WHAT_DOES_NOT,
  CLUSTERING_TITLE_RULE,
  CLUSTERING_OTHER_RULES,
} from './prompts';

@Injectable()
export class ScoringPromptService {
  constructor(private readonly configService: DragnetConfigService) {}

  /** Build tiered figure list grouped by priority tier. */
  private buildTieredFigures(): string {
    const config = this.configService.getConfig();
    const byTier: Record<string, string[]> = {
      top_priority: [],
      high_priority: [],
      monitor: [],
    };

    for (const f of config.figures) {
      const tier = byTier[f.tier];
      if (tier) tier.push(f.name);
    }

    const sections: string[] = [];
    if (byTier.top_priority.length) {
      sections.push(`TOP PRIORITY — Always flag new content from these figures:\n${byTier.top_priority.join(', ')}`);
    }
    if (byTier.high_priority.length) {
      sections.push(`HIGH PRIORITY — Flag when content is substantive:\n${byTier.high_priority.join(', ')}`);
    }
    if (byTier.monitor.length) {
      sections.push(`MONITOR — Flag only if content is exceptional or reveals a pattern:\n${byTier.monitor.join(', ')}`);
    }
    return sections.join('\n\n');
  }

  /** Build prioritized subject list grouped by priority level. */
  private buildPrioritizedSubjects(includeKeywords: boolean): string {
    const config = this.configService.getConfig();
    const enabled = config.subjects.filter((s) => s.enabled);

    const byPriority: Record<number, typeof enabled> = {};
    for (const s of enabled) {
      const p = s.priority || 1;
      if (!byPriority[p]) byPriority[p] = [];
      byPriority[p].push(s);
    }

    const priorityLabels: Record<number, string> = {
      1: 'PRIORITY 1 — Core subjects. Always include relevant content:',
      2: 'PRIORITY 2 — Major subjects. Include when material is substantive:',
      3: 'PRIORITY 3 — Include when content is strong or intersects Priority 1-2:',
    };

    const sections: string[] = [];
    for (const p of Object.keys(byPriority).map(Number).sort()) {
      const label = priorityLabels[p] || `PRIORITY ${p}:`;
      const lines = byPriority[p].map((s) => {
        const kw = includeKeywords ? ` (keywords: ${s.keywords.slice(0, 5).join(', ')}...)` : '';
        return `- "${s.id}": ${s.label}${kw}`;
      });
      sections.push(`${label}\n${lines.join('\n')}`);
    }
    return sections.join('\n\n');
  }

  /** Build editorial voice block if configured. */
  private buildEditorialVoiceBlock(): string {
    const config = this.configService.getConfig();
    const voice = config.scoring.editorialVoice?.trim();
    if (!voice) return '';
    return `\nEDITORIAL CONTEXT:\n${voice}\n\nUse this context to evaluate which items have the most analytical value. Content that rewards this lens should score higher.\n`;
  }

  /** Step 1: Triage — send all titles, get back IDs of interesting items. */
  buildTriagePrompt(items: ScoredItem[], customInstructions?: string, searchQuery?: string): string {
    const config = this.configService.getConfig();

    const itemLines = items.map((item) => {
      const nsfwFlag = (item.metadata as any)?.nsfw ? ' [NSFW]' : '';
      const typeTag = item.contentType === 'video' ? ' [VIDEO]' : '';
      const source = item.sourceAccount ? ` | ${item.sourceAccount}` : '';
      return `${item.id} | ${item.platform}${source} | ${item.title}${typeTag}${nsfwFlag}`;
    }).join('\n');

    const instructions = customInstructions?.trim() || config.scoring.editorialNotes?.trim();
    const instructionsBlock = instructions
      ? `\nCUSTOM INSTRUCTIONS:\n${instructions}\n`
      : '';

    // For quick search, use the search query as the primary context
    if (searchQuery) {
      return `You are a content relevance filter for an ad-hoc search about "${searchQuery}".

Identify which items are relevant, interesting, or newsworthy in relation to "${searchQuery}". Be INCLUSIVE — if there's a reasonable chance an item is relevant to the search topic, include it. Only filter out items that are clearly unrelated noise or generic/banal content with no informational value.
${instructionsBlock}
ITEMS (${items.length} — format: ID | platform | source | title):
${itemLines}

${TRIAGE_RESPONSE_FORMAT}`;
    }

    const subjectList = this.buildPrioritizedSubjects(true);
    const figureList = this.buildTieredFigures();
    const editorialVoice = this.buildEditorialVoiceBlock();

    return `${TRIAGE_SYSTEM}

TRACKED SUBJECTS:
${subjectList}

KEY FIGURES:
${figureList}
${editorialVoice}${instructionsBlock}
IMPORTANT: Items posted directly from a tracked figure's own account/channel (check the "source" column) should almost always be included — their own output is primary-source material even when the title looks generic.

ITEMS (${items.length} — format: ID | platform | source | title):
${itemLines}

${TRIAGE_RESPONSE_FORMAT}`;
  }

  /** Truncate text to first N chars, cutting at word boundary. */
  private snippet(text: string | undefined, maxLen = 120): string {
    if (!text) return '';
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLen) return clean;
    const cut = clean.slice(0, maxLen);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 60 ? cut.slice(0, lastSpace) : cut) + '...';
  }

  /** Step 2: Classify — score interesting items + group into story clusters. */
  buildClassifyPrompt(items: ScoredItem[], customInstructions?: string, searchQuery?: string): string {
    const config = this.configService.getConfig();

    const itemLines = items.map((item) => {
      const nsfwFlag = (item.metadata as any)?.nsfw ? ' [NSFW]' : '';
      const typeTag = item.contentType === 'video' ? ' [VIDEO]' : '';
      const snip = this.snippet(item.textContent);
      const snipSuffix = snip ? `\n  > ${snip}` : '';
      return `${item.id} | ${item.platform} | ${item.sourceAccount} | ${item.title}${typeTag}${nsfwFlag}${snipSuffix}`;
    }).join('\n');

    const instructions = customInstructions?.trim() || config.scoring.editorialNotes?.trim();
    const instructionsBlock = instructions
      ? `\nCUSTOM SCORING INSTRUCTIONS:\n${instructions}\n`
      : '';

    // For quick search, use a search-focused classify prompt
    if (searchQuery) {
      const targetCount = Math.min(8, Math.max(2, Math.floor(items.length / 5)));
      return `You are a news desk editor curating search results about "${searchQuery}".

Score each item for how interesting, newsworthy, or revealing it is in relation to "${searchQuery}". Then group the most compelling items into story clusters.

WHAT SCORES HIGH (8-10):
- Breaking news, major developments, or revelations about "${searchQuery}"
- Unique angles or information most people haven't seen
- Video clips [VIDEO] with clear editorial value — a video is worth more than a text article covering the same thing
- Contradictions, confrontations, or mask-off moments
- Content that reveals something structural, not just surface-level mentions

WHAT SCORES MEDIUM (5-7):
- Solid coverage with real substance or new information
- Interesting commentary, reactions, or analysis
- Video content even if the angle isn't unique

WHAT SCORES LOW (1-4):
- Generic mentions without substance — just name-drops or keyword matches
- Repetitive content with nothing new
- Banal or uninteresting content that happens to mention the search term

${SCORING_CLIP_TYPES}

${CLUSTERING_WHAT_MAKES}

${CLUSTERING_WHAT_DOES_NOT}

${CLUSTERING_TITLE_RULE}
${instructionsBlock}
ITEMS TO SCORE AND CLUSTER (${items.length} items — format: ID | platform | source | title, with optional content snippet on next line):
${itemLines}

Respond with ONLY a JSON object containing scored items and story clusters:
{
  "items": [
    {
      "id": "item-uuid",
      "score": 8,
      "summary": "Brief relevance summary (max 15 words)",
      "clip_type": "breaking",
      "tags": ["topic_tag"]
    }
  ],
  "clusters": [
    {
      "title": "Headline-style story title",
      "summary": "1-2 sentence story summary",
      "subjects": ["topic_tag"],
      "itemIds": ["item-uuid-1", "item-uuid-2"]
    }
  ]
}

RULES FOR ITEMS:
- Score EVERY item listed above (1-10 scale)
- "tags": short topic labels you invent based on the content (e.g. "venezuela_controversy", "prophecy_claims")
- "clip_type": one of "breaking", "analysis", "quote", "event", "background"

RULES FOR CLUSTERS:
- Only create clusters for genuinely interesting, well-defined stories — not broad themes
- Target roughly ${targetCount} clusters. Quality over quantity. It's fine to have fewer if fewer stories are compelling.
- A single item scoring 9-10 can be a standalone cluster if it's a major development
- Don't force items into clusters — unclustered items are fine
- Don't create catch-all or "miscellaneous" clusters

ONLY the JSON object. Nothing else.`;
    }

    const subjectDescriptions = this.buildPrioritizedSubjects(true);
    const figureList = this.buildTieredFigures();
    const editorialVoice = this.buildEditorialVoiceBlock();
    // Scale target down for small item sets — don't ask for 12 clusters from 30 items
    const configTarget = config.scoring.targetClusterCount || 12;
    const targetCount = Math.min(configTarget, Math.max(3, Math.floor(items.length / 4)));
    const classifyFormat = CLASSIFY_RESPONSE_FORMAT.replace(
      /\{\{TARGET_CLUSTER_COUNT\}\}/g,
      String(targetCount),
    );

    return `${CLASSIFY_SYSTEM}

SUBJECT AREAS:
${subjectDescriptions}

KEY FIGURES TO WATCH:
${figureList}

${SCORING_HIGH}

${SCORING_MEDIUM}

${SCORING_LOW}

${SCORING_CLIP_TYPES}

${CLUSTERING_WHAT_MAKES}

${CLUSTERING_WHAT_DOES_NOT}

${CLUSTERING_TITLE_RULE}
${editorialVoice}${instructionsBlock}
ITEMS TO SCORE AND CLUSTER (${items.length} items — format: ID | platform | source | title, with optional content snippet on next line):
${itemLines}

${classifyFormat}`;
  }

  /** Step 4: Classify expansion items against existing clusters. */
  buildExpansionClassifyPrompt(
    items: ScoredItem[],
    existingClusters: StoryCluster[],
    customInstructions?: string,
  ): string {
    const config = this.configService.getConfig();

    const subjectDescriptions = this.buildPrioritizedSubjects(false);

    const clusterList = existingClusters.map((c) =>
      `- "${c.title}" (${c.itemIds.length} items, subjects: ${c.subjects.join(', ')})`,
    ).join('\n');

    const itemLines = items.map((item) => {
      const nsfwFlag = (item.metadata as any)?.nsfw ? ' [NSFW]' : '';
      const typeTag = item.contentType === 'video' ? ' [VIDEO]' : '';
      const snip = this.snippet(item.textContent);
      const snipSuffix = snip ? `\n  > ${snip}` : '';
      return `${item.id} | ${item.platform} | ${item.sourceAccount} | ${item.title}${typeTag}${nsfwFlag}${snipSuffix}`;
    }).join('\n');

    const instructions = customInstructions?.trim() || config.scoring.editorialNotes?.trim();
    const instructionsBlock = instructions
      ? `\nCUSTOM SCORING INSTRUCTIONS:\n${instructions}\n`
      : '';

    const editorialVoice = this.buildEditorialVoiceBlock();
    const figureList = this.buildTieredFigures();

    return `${CLASSIFY_SYSTEM}

SUBJECT AREAS:
${subjectDescriptions}

KEY FIGURES TO WATCH:
${figureList}

${SCORING_HIGH}

${SCORING_LOW}

EXISTING STORY CLUSTERS:
${clusterList}

${CLUSTERING_WHAT_MAKES}

${CLUSTERING_WHAT_DOES_NOT}
${editorialVoice}${instructionsBlock}
NEW ITEMS TO SCORE AND ASSIGN (${items.length} items — format: ID | platform | source | title, with optional content snippet on next line):
${itemLines}

${CLASSIFY_EXPANSION_RESPONSE_FORMAT}`;
  }
}
