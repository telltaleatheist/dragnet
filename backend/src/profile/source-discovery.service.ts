import { Injectable, Logger } from '@nestjs/common';

export interface RedditSubredditResult {
  name: string;
  subscribers: number;
  description: string;
}

export interface ValidationResult {
  valid: boolean;
  resolvedValue?: string; // e.g. resolved YouTube channel ID
  reason?: string;
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Reddit requires a descriptive user-agent in "platform:appname:version (by /u/user)" format.
// Generic UAs get aggressively rate-limited.
const REDDIT_UA = 'desktop:com.dragnet.app:v1.0 (personal feed reader)';

@Injectable()
export class SourceDiscoveryService {
  private readonly logger = new Logger(SourceDiscoveryService.name);

  // --- Reddit Subreddit Search ---

  async searchSubreddits(query: string): Promise<{ status: number; results: RedditSubredditResult[] }> {
    try {
      const url = `https://www.reddit.com/subreddits/search.json?q=${encodeURIComponent(query)}&limit=25`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': REDDIT_UA,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        if (response.status !== 429) {
          this.logger.warn(`Reddit search returned ${response.status} for query "${query}"`);
        }
        return { status: response.status, results: [] };
      }

      const data = await response.json();
      const children = data?.data?.children || [];

      const results = children
        .map((child: any) => ({
          name: child.data.display_name,
          subscribers: child.data.subscribers || 0,
          description: child.data.public_description || '',
        }))
        .filter((sub: RedditSubredditResult) => sub.subscribers > 100);
      return { status: 200, results };
    } catch (err) {
      this.logger.warn(`Reddit subreddit search failed for "${query}": ${(err as Error).message}`);
      return { status: 0, results: [] };
    }
  }

  async discoverSubredditsForKeywords(keywords: string[]): Promise<RedditSubredditResult[]> {
    const seen = new Set<string>();
    const results: RedditSubredditResult[] = [];
    const searchTerms = keywords.slice(0, 10);

    let consecutive429 = 0;
    for (let i = 0; i < searchTerms.length; i++) {
      const term = searchTerms[i];
      const { status, results: subs } = await this.searchSubreddits(term);

      if (status === 429) {
        consecutive429++;
        // After two 429s in a row Reddit is clearly throttling us — bail out.
        // AI-suggested subreddits still cover us; this is just bonus discovery.
        if (consecutive429 >= 2) {
          this.logger.warn(
            `Reddit search rate-limited (429) — skipping ${searchTerms.length - i - 1} remaining keywords. Using AI-suggested subreddits only.`,
          );
          break;
        }
      } else {
        consecutive429 = 0;
      }

      for (const sub of subs) {
        const key = sub.name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          results.push(sub);
        }
      }

      // Reddit's unauthenticated limit is ~10 req/min. 6s between requests keeps
      // us safely under that; longer on 429 to give the bucket time to refill.
      const delay = status === 429 ? 15000 : 6000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    results.sort((a, b) => b.subscribers - a.subscribers);
    return results;
  }

  // --- Source Validation ---

  async validateSubreddit(name: string): Promise<ValidationResult> {
    try {
      const url = `https://www.reddit.com/r/${encodeURIComponent(name)}/about.json`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': REDDIT_UA,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (response.status === 404) {
        return { valid: false, reason: 'subreddit does not exist' };
      }
      if (response.status === 403) {
        // Private/quarantined — exists but inaccessible
        return { valid: false, reason: 'subreddit is private or quarantined' };
      }
      if (!response.ok) {
        // Could be rate-limited; assume valid to avoid false negatives
        return { valid: true };
      }
      const data = await response.json();
      if (data?.data?.over18) {
        // Exists but is an NSFW subreddit — include but flag it
        return { valid: true, reason: 'nsfw' };
      }
      return { valid: true };
    } catch {
      // Network error — assume valid to avoid false negatives
      return { valid: true };
    }
  }

  async resolveYouTubeChannelId(channelName: string): Promise<ValidationResult> {
    // First: if it already looks like a channel ID, verify it directly
    if (channelName.startsWith('UC') && channelName.length >= 20) {
      try {
        const verified = await this.verifyYouTubeChannelId(channelName);
        if (verified) return { valid: true, resolvedValue: channelName };
      } catch {
        // fall through to soft-accept
      }
      return { valid: true, resolvedValue: channelName };
    }

    // 1) Try the @handle URL directly — cheaper and more reliable than search
    const handle = channelName.replace(/\s+/g, '').replace(/^@/, '');
    const fromHandle = await this.tryExtractChannelId(`https://www.youtube.com/@${handle}`);
    if (fromHandle) {
      this.logger.log(`Resolved YouTube "${channelName}" → ${fromHandle} (via @handle)`);
      return { valid: true, resolvedValue: fromHandle };
    }

    // 2) Fall back to the search results page
    const fromSearch = await this.tryExtractChannelId(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(channelName)}&sp=EgIQAg%3D%3D`,
    );
    if (fromSearch) {
      this.logger.log(`Resolved YouTube "${channelName}" → ${fromSearch} (via search)`);
      return { valid: true, resolvedValue: fromSearch };
    }

    // 3) Soft-accept: keep the source with the channel name as the value so the
    // scraping layer can attempt resolution later. Dropping every YouTube source
    // on a transient network blip would gut the profile's YouTube coverage.
    this.logger.warn(`YouTube resolve failed for "${channelName}" — keeping as unresolved`);
    return { valid: true, resolvedValue: channelName };
  }

  private async tryExtractChannelId(url: string): Promise<string | null> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(12000),
        redirect: 'follow',
      });
      if (!response.ok) return null;
      const html = await response.text();
      const match = html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
      if (match) return match[1];
      const externalId = html.match(/"externalId":"(UC[a-zA-Z0-9_-]{22})"/);
      if (externalId) return externalId[1];
      return null;
    } catch {
      return null;
    }
  }

  private async verifyYouTubeChannelId(channelId: string): Promise<boolean> {
    try {
      const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
      const response = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(8000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async validateRssFeed(feedUrl: string): Promise<ValidationResult> {
    const fetchWithUA = (url: string) =>
      fetch(url, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(10000),
        redirect: 'follow',
      });

    // Phase 1: try the URL the AI gave us.
    let firstError: string = 'not a valid RSS/Atom feed';
    try {
      const response = await fetchWithUA(feedUrl);
      if (response.ok) {
        const text = await response.text();
        if (this.looksLikeFeed(text)) {
          return { valid: true };
        }
        // Got HTML — try auto-discovery on this page
        const discovered = this.discoverFeedLink(text, feedUrl);
        if (discovered && discovered !== feedUrl) {
          const ok = await this.verifyFeedUrl(discovered, fetchWithUA);
          if (ok) {
            this.logger.log(`Discovered RSS feed for ${feedUrl} → ${discovered}`);
            return { valid: true, resolvedValue: discovered };
          }
        }
      } else {
        firstError = `HTTP ${response.status}`;
      }
    } catch (err) {
      firstError = (err as Error).message;
    }

    // Phase 2: fall back to the site root for auto-discovery. This catches
    // cases where the AI guessed a plausible-sounding but wrong feed path
    // (404) or the site blocks a deep-linked feed URL (403) but exposes RSS
    // from the homepage.
    try {
      const root = new URL(feedUrl).origin + '/';
      if (root !== feedUrl) {
        const rootResponse = await fetchWithUA(root);
        if (rootResponse.ok) {
          const rootHtml = await rootResponse.text();
          const discovered = this.discoverFeedLink(rootHtml, root);
          if (discovered) {
            const ok = await this.verifyFeedUrl(discovered, fetchWithUA);
            if (ok) {
              this.logger.log(`Discovered RSS feed for ${feedUrl} via root → ${discovered}`);
              return { valid: true, resolvedValue: discovered };
            }
          }
        }
      }
    } catch {
      // ignore — fall through to failure
    }

    return { valid: false, reason: firstError };
  }

  private async verifyFeedUrl(
    url: string,
    fetchWithUA: (u: string) => Promise<Response>,
  ): Promise<boolean> {
    try {
      const res = await fetchWithUA(url);
      if (!res.ok) return false;
      const body = await res.text();
      return this.looksLikeFeed(body);
    } catch {
      return false;
    }
  }

  private looksLikeFeed(body: string): boolean {
    const head = body.slice(0, 2048).toLowerCase();
    return (
      head.includes('<rss') ||
      head.includes('<feed') ||
      head.includes('<?xml') && (head.includes('<channel') || head.includes('<rdf'))
    );
  }

  private discoverFeedLink(html: string, baseUrl: string): string | null {
    // Look for <link rel="alternate" type="application/rss+xml" href="...">
    // Attributes can appear in any order and use single or double quotes.
    const linkTags = html.match(/<link\b[^>]*>/gi) || [];
    for (const tag of linkTags) {
      const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      const type = /type\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      if (!rel || !href) continue;
      if (rel.toLowerCase() !== 'alternate') continue;
      if (type && !/rss|atom|xml/i.test(type)) continue;
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        continue;
      }
    }
    return null;
  }

  // --- Batch Validation ---

  async validateSources(sources: {
    platform: string;
    sourceType: string;
    name: string;
    value: string;
  }[]): Promise<{
    valid: typeof sources;
    invalid: (typeof sources[0] & { reason: string })[];
  }> {
    const valid: typeof sources = [];
    const invalid: (typeof sources[0] & { reason: string })[] = [];

    for (const source of sources) {
      let result: ValidationResult;

      switch (source.platform) {
        case 'reddit':
          result = await this.validateSubreddit(source.value);
          await this.delay(1500); // Rate limit
          break;

        case 'youtube':
          result = await this.resolveYouTubeChannelId(source.value);
          if (result.valid && result.resolvedValue) {
            source.value = result.resolvedValue;
          }
          await this.delay(1000);
          break;

        case 'web':
          result = await this.validateRssFeed(source.value);
          if (result.valid && result.resolvedValue) {
            source.value = result.resolvedValue;
          }
          await this.delay(500);
          break;

        default:
          // Twitter, TikTok — can't easily validate, assume valid
          result = { valid: true };
          break;
      }

      if (result.valid) {
        valid.push(source);
      } else {
        this.logger.warn(`Source validation failed: ${source.platform}/${source.name} — ${result.reason}`);
        invalid.push({ ...source, reason: result.reason || 'unknown' });
      }
    }

    this.logger.log(`Source validation: ${valid.length} valid, ${invalid.length} invalid`);
    return { valid, invalid };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
