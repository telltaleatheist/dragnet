import { Injectable } from '@nestjs/common';
import { DragnetConfigService } from '../config/dragnet-config.service';
import { StoredItem } from '../database/items.service';

@Injectable()
export class ScoringPromptService {
  constructor(private readonly configService: DragnetConfigService) {}

  buildBatchPrompt(items: StoredItem[]): string {
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
      const text = item.text_content
        ? item.text_content.slice(0, 800)
        : '(no text content)';
      return `--- ITEM ${i + 1} (id: ${item.id}) ---
Title: ${item.title}
Author: ${item.author}
Platform: ${item.platform}
Source: ${item.source_account}
Content: ${text}`;
    }).join('\n\n');

    return `You are a content relevance scorer for an investigative research tool that supports a podcast/livestream covering Christian nationalism, right-wing extremism, prophecy grift, and religious abuse. Score each item based on how useful it would be for show prep and research.

SUBJECT AREAS:
${subjectDescriptions}

KEY FIGURES TO WATCH:
${figureNames}

WHAT SCORES HIGH (8-10):
- Key figures caught in mask-off moments — saying the quiet part loud, revealing true ideology
- Breaking news about tracked figures or subjects (arrests, deaths, lawsuits, leaked documents, firings)
- Internal movement conflicts — figures turning on each other, public feuds, schisms
- Hypocrisy with receipts — figures contradicting their own stated positions with evidence
- Genuinely extreme or unhinged statements that reveal escalation beyond the norm
- JW/Watchtower content — ANY content about Jehovah's Witnesses or Watchtower gets MINIMUM score of 7
- Direct confrontations — tracked figures being challenged in public, at hearings, rallies

WHAT SCORES MEDIUM (5-7):
- Tracked figures doing standard content (preaching, posting, streaming) that reinforces known patterns
- Subject-adjacent news with genuine analytical depth or new information
- Pattern evidence — content showing escalation, contradiction over time, or shifting rhetoric
- Coverage from watchdog organizations or investigative journalists on tracked subjects
- New figures emerging in tracked subject areas

WHAT SCORES LOW (1-4):
- Generic tangential mentions of keywords with no substantive connection to core subjects
- Rehearsed talking points with nothing new — same sermon, same rant, no development
- Oversaturated stories with no unique angle — if every outlet has it, it needs a fresh take to score well
- Obscure figures saying standard things within tracked subjects
- Aggregated or repackaged content with no original reporting

JW/WATCHTOWER AUTO-BOOST:
Any item mentioning Jehovah's Witnesses, Watchtower, governing body, disfellowshipping, shunning, kingdom hall, PIMO, or Bethel MUST receive a minimum score of 7. This is non-negotiable.

CLIP TYPE GUIDANCE:
- "breaking" — deaths, arrests, major events, leaked documents, court rulings, sudden developments
- "quote" — mask-off moments, extreme statements, hot mic, unhinged rants worth clipping verbatim
- "analysis" — pattern/trend pieces, investigative reporting, watchdog coverage, deep dives
- "event" — rallies, hearings, confrontations, protests, church events worth covering
- "background" — contextual info, historical reference, profile pieces, lesser items still worth filing

ITEMS TO SCORE:
${itemBlocks}

Respond with a JSON array. Each element must have these fields:
- "id": the item ID from above
- "score": integer 1-10
- "tags": array of subject IDs that apply (e.g. ["christian_nationalism", "prophecy_grift"])
- "summary": one-sentence relevance summary
- "clip_type": one of "breaking", "analysis", "quote", "event", "background"
- "reasoning": brief explanation of score

Respond ONLY with the JSON array, no markdown fences or extra text.`;
  }
}
