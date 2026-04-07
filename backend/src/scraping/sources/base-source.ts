import { Logger } from '@nestjs/common';

export interface RawContentItem {
  url: string;
  title: string;
  author: string;
  platform: string;
  contentType: string;
  textContent?: string;
  publishedAt?: string;
  thumbnailUrl?: string;
  sourceAccount: string;
  metadata?: Record<string, unknown>;
}

export interface DeadSource {
  platform: string;
  sourceType: string;
  value: string;
  reason: string;
}

export abstract class BaseSource {
  protected abstract readonly logger: Logger;
  abstract readonly platform: string;

  /** Sources that returned 404/410 during the last fetch — should be removed */
  protected deadSources: DeadSource[] = [];

  abstract fetch(config: any): Promise<RawContentItem[]>;

  /** Get sources that were confirmed dead (404/410) during the last fetch, then clear the list */
  getAndClearDeadSources(): DeadSource[] {
    const dead = [...this.deadSources];
    this.deadSources = [];
    return dead;
  }

  protected normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      // Strip tracking params
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
       'ref', 'fbclid', 'gclid', 'mc_cid', 'mc_eid'].forEach(
        (p) => parsed.searchParams.delete(p),
      );
      // Normalize www — strip www. prefix
      if (parsed.hostname.startsWith('www.')) {
        parsed.hostname = parsed.hostname.slice(4);
      }
      // Strip trailing slash from pathname (but keep "/" root)
      if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
        parsed.pathname = parsed.pathname.slice(0, -1);
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }

  protected truncateText(text: string, maxLength: number = 5000): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
  }

  /** Check if text is likely English using character-set heuristics. */
  protected isLikelyEnglish(text: string): boolean {
    return isLikelyEnglish(text);
  }
}

/** Pool of realistic browser User-Agent strings for Reddit requests. */
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
];

/** Pick a random User-Agent from the pool. */
export function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/** Sleep for a duration with ±30% random jitter. */
export function jitteredDelay(baseMs: number): Promise<void> {
  const jitter = baseMs * 0.3 * (Math.random() * 2 - 1);
  return new Promise((r) => setTimeout(r, Math.max(500, baseMs + jitter)));
}

/** Check if text is likely English using character-set heuristics (no dependencies).
 *  Returns true for short/empty strings by default.
 *  Exported as a standalone function so non-source classes can use it. */
export function isLikelyEnglish(text: string): boolean {
  if (!text || text.length < 10) return true;

  let nonLatin = 0;
  let alphabetic = 0;

  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x41) continue; // skip ASCII punctuation/digits/whitespace

    // CJK Unified Ideographs + Extensions
    if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x20000 && code <= 0x2A6DF)) {
      nonLatin++; alphabetic++; continue;
    }
    // Hiragana, Katakana
    if (code >= 0x3040 && code <= 0x30FF) { nonLatin++; alphabetic++; continue; }
    // Hangul
    if (code >= 0xAC00 && code <= 0xD7AF) { nonLatin++; alphabetic++; continue; }
    // Arabic
    if (code >= 0x0600 && code <= 0x06FF) { nonLatin++; alphabetic++; continue; }
    // Cyrillic
    if (code >= 0x0400 && code <= 0x04FF) { nonLatin++; alphabetic++; continue; }
    // Thai
    if (code >= 0x0E00 && code <= 0x0E7F) { nonLatin++; alphabetic++; continue; }
    // Indic scripts: Devanagari, Bengali, Gurmukhi, Gujarati, Tamil, Telugu, Kannada, Malayalam
    if (code >= 0x0900 && code <= 0x0D7F) { nonLatin++; alphabetic++; continue; }
    // Sinhala, Myanmar, Georgian, Ethiopic
    if (code >= 0x0D80 && code <= 0x137F) { nonLatin++; alphabetic++; continue; }
    // Hebrew
    if (code >= 0x0590 && code <= 0x05FF) { nonLatin++; alphabetic++; continue; }
    // Latin (Basic + Extended)
    if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A) ||
        (code >= 0x00C0 && code <= 0x024F)) {
      alphabetic++; continue;
    }
  }

  if (alphabetic === 0) return true;
  return (nonLatin / alphabetic) <= 0.3;
}
