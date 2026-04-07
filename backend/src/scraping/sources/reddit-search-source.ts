import { Injectable, Logger } from '@nestjs/common';
import { BaseSource, RawContentItem, randomUserAgent, jitteredDelay } from './base-source';
import type { DiscoverySourceConfig, SubjectProfile, FigureProfile } from '../../../../shared/types';

interface RedditSearchConfig extends DiscoverySourceConfig {
  subjects: SubjectProfile[];
  figures: FigureProfile[];
  videoOnly?: boolean;
}

interface RedditSearchChild {
  kind?: string;
  data: {
    id: string;
    title: string;
    author: string;
    subreddit: string;
    permalink: string;
    url: string;
    selftext?: string;
    created_utc: number;
    thumbnail?: string;
    is_video?: boolean;
    domain?: string;
    over_18?: boolean;
    subreddit_type?: string;
    promoted?: boolean;
    is_promoted?: boolean;
  };
}

@Injectable()
export class RedditSearchSource extends BaseSource {
  protected readonly logger = new Logger(RedditSearchSource.name);
  readonly platform = 'reddit';

  private blocked = false;

  async fetch(config: RedditSearchConfig): Promise<RawContentItem[]> {
    if (!config.enabled) return [];
    this.blocked = false;

    const queries = this.buildQueries(config.subjects, config.figures);
    const items: RawContentItem[] = [];

    for (const query of queries) {
      if (this.blocked) {
        this.logger.warn('Reddit IP blocked — skipping remaining queries');
        break;
      }

      try {
        const results = await this.searchReddit(query);
        items.push(...results);
      } catch (err) {
        this.logger.warn(`Reddit search "${query}" failed: ${(err as Error).message}`);
      }

      // 5s delay (±30% jitter) between queries to avoid Reddit rate limits
      await jitteredDelay(5000);
    }

    // Video-only filtering happens here — searchReddit always fetches all content types
    if (config.videoOnly) {
      const videos = items.filter((item) => item.contentType === 'video');
      this.logger.log(`Reddit search: ${items.length} total, ${videos.length} videos (video-only mode)`);
      return videos;
    }

    return items;
  }

  private buildQueries(subjects: SubjectProfile[], figures: FigureProfile[]): string[] {
    const queries: string[] = [];

    // One query per enabled subject. Reddit search treats spaces as AND,
    // so multi-word keywords like "cult deprogramming exit counseling"
    // require ALL words present — matching almost nothing. Only use
    // short keywords (≤3 words) and always include the subject label.
    for (const subject of subjects) {
      if (!subject.enabled) continue;

      const terms: string[] = [subject.label];

      for (const kw of subject.keywords) {
        if (kw.startsWith('#') || kw.length < 4) continue;
        const wordCount = kw.trim().split(/\s+/).length;
        if (wordCount <= 3) terms.push(kw);
      }

      // Deduplicate (case-insensitive) and cap at 8 terms
      const seen = new Set<string>();
      const unique = terms.filter((t) => {
        const lower = t.toLowerCase();
        if (seen.has(lower)) return false;
        seen.add(lower);
        return true;
      }).slice(0, 8);

      if (unique.length > 0) {
        queries.push(unique.join(' OR '));
      }
    }

    // Group top_priority figures 5 per query, quoted for exact name matching.
    const topFigures = figures
      .filter((f) => f.tier === 'top_priority')
      .map((f) => `"${f.name}"`);

    for (let i = 0; i < topFigures.length; i += 5) {
      queries.push(topFigures.slice(i, i + 5).join(' OR '));
    }

    return queries;
  }

  private async searchReddit(query: string): Promise<RawContentItem[]> {
    const encoded = encodeURIComponent(query);

    // Two passes: relevance (balances recency + engagement) and top/day (viral posts)
    const urls = [
      `https://www.reddit.com/search.json?q=${encoded}&sort=relevance&t=week&limit=100`,
      `https://www.reddit.com/search.json?q=${encoded}&sort=top&t=day&limit=100`,
    ];

    const seen = new Set<string>();
    const items: RawContentItem[] = [];

    for (const url of urls) {
      if (this.blocked) break;

      const response = await fetch(url, {
        headers: {
          'User-Agent': randomUserAgent(),
          'Accept': 'application/json',
        },
      });

      // Detect IP block: 429, 403, or HTML response (Reddit returns login page)
      if (response.status === 429 || response.status === 403) {
        this.logger.warn(`Reddit returned ${response.status} — IP likely blocked`);
        this.blocked = true;
        break;
      }

      if (!response.ok) {
        this.logger.warn(`HTTP ${response.status} for reddit search "${query}" (${url.includes('sort=top') ? 'top' : 'relevance'})`);
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        this.logger.warn('Reddit returned HTML instead of JSON — IP likely blocked');
        this.blocked = true;
        break;
      }

      const json = await response.json();
      const children: RedditSearchChild[] = json?.data?.children || [];

      for (const child of children) {
        if (!child.data?.permalink) continue;
        if (child.data.promoted || child.data.is_promoted) continue;
        if (child.kind && child.kind !== 't3') continue;
        if (seen.has(child.data.permalink)) continue;
        seen.add(child.data.permalink);
        items.push(this.parseChild(child, query));
      }

      // 3s delay (±30% jitter) between passes
      if (url !== urls[urls.length - 1]) {
        await jitteredDelay(3000);
      }
    }

    this.logger.log(`Reddit search "${query}": ${items.length} unique results (2 passes)`);
    return items;
  }

  private parseChild(child: RedditSearchChild, query: string): RawContentItem {
    const d = child.data;
    const postUrl = `https://www.reddit.com${d.permalink}`;
    const contentType = this.detectContentType(d);

    let thumbnailUrl: string | undefined;
    if (d.thumbnail && d.thumbnail.startsWith('http')) {
      thumbnailUrl = d.thumbnail;
    }

    return {
      url: this.normalizeUrl(postUrl),
      title: d.title,
      author: d.author || 'unknown',
      platform: 'reddit',
      contentType,
      textContent: d.selftext ? this.truncateText(d.selftext) : undefined,
      publishedAt: new Date(d.created_utc * 1000).toISOString(),
      thumbnailUrl,
      sourceAccount: `r/${d.subreddit}`,
      metadata: { subreddit: d.subreddit, searchQuery: query, nsfw: !!d.over_18 },
    };
  }

  private detectContentType(data: RedditSearchChild['data']): string {
    if (data.is_video) return 'video';
    const url = data.url || '';
    const domain = data.domain || '';
    if (url.includes('v.redd.it') || url.includes('youtube.com') || url.includes('youtu.be')
      || url.includes('tiktok.com') || url.includes('streamable.com') || url.includes('clips.twitch.tv')
      || domain === 'v.redd.it') {
      return 'video';
    }
    if (url.includes('i.redd.it') || url.includes('imgur.com')) {
      return 'image';
    }
    if (domain && !domain.includes('reddit.com')) {
      return 'article';
    }
    return 'text';
  }
}
