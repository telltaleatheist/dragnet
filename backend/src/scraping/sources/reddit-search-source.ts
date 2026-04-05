import { Injectable, Logger } from '@nestjs/common';
import { BaseSource, RawContentItem } from './base-source';
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

  async fetch(config: RedditSearchConfig): Promise<RawContentItem[]> {
    if (!config.enabled) return [];

    const queries = this.buildQueries(config.subjects, config.figures);
    const items: RawContentItem[] = [];

    for (const query of queries) {
      try {
        if (config.videoOnly) {
          const results = await this.searchRedditVideoOnly(query);
          items.push(...results);
        } else {
          const results = await this.searchReddit(query);
          items.push(...results);
        }
      } catch (err) {
        this.logger.warn(`Reddit search "${query}" failed: ${(err as Error).message}`);
      }

      // 2.5s delay between queries to avoid Reddit 429 rate limits
      await new Promise((r) => setTimeout(r, 2500));
    }

    return items;
  }

  private buildQueries(subjects: SubjectProfile[], figures: FigureProfile[]): string[] {
    // Combine all keywords + figures into one big OR query.
    // Reddit search handles long OR chains fine and this avoids rate limiting.
    const allTerms: string[] = [];

    for (const subject of subjects) {
      if (!subject.enabled) continue;

      const usable = subject.keywords
        .filter((kw) => !kw.startsWith('#') && kw.length >= 4)
        .slice(0, 5);

      for (const kw of usable) {
        const term = kw.includes(' ') ? `"${kw}"` : kw;
        if (!allTerms.includes(term)) allTerms.push(term);
      }
    }

    for (const figure of figures) {
      if (figure.tier === 'top_priority') {
        const name = figure.name.includes(' ') ? `"${figure.name}"` : figure.name;
        if (!allTerms.includes(name)) allTerms.push(name);
      }
    }

    if (allTerms.length === 0) return [];

    // Reddit URL length limit is ~8000 chars. Split into chunks if needed.
    const queries: string[] = [];
    let current: string[] = [];
    let currentLen = 0;

    for (const term of allTerms) {
      // " OR " is 4 chars
      const addition = current.length === 0 ? term.length : term.length + 4;
      if (currentLen + addition > 1500 && current.length > 0) {
        queries.push(current.join(' OR '));
        current = [term];
        currentLen = term.length;
      } else {
        current.push(term);
        currentLen += addition;
      }
    }
    if (current.length > 0) {
      queries.push(current.join(' OR '));
    }

    return queries;
  }

  private async searchReddit(query: string): Promise<RawContentItem[]> {
    const encoded = encodeURIComponent(query);
    const url = `https://www.reddit.com/search.json?q=${encoded}&sort=new&t=week&limit=25`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for reddit search "${query}"`);
    }

    const json = await response.json();
    const children: RedditSearchChild[] = json?.data?.children || [];

    return children
      .filter((child) => {
        if (!child.data?.permalink) return false;
        // Filter out Reddit ads/promoted posts
        if (child.data.promoted || child.data.is_promoted) return false;
        if (child.kind && child.kind !== 't3') return false;
        return true;
      })
      .map((child) => this.parseChild(child, query));
  }

  /** Fetch 3 pages of normal Reddit results, then filter to video posts only. */
  private async searchRedditVideoOnly(query: string): Promise<RawContentItem[]> {
    const allItems: RawContentItem[] = [];
    let after: string | null = null;
    const maxPages = 3;

    for (let page = 0; page < maxPages; page++) {
      const encoded = encodeURIComponent(query);
      let url = `https://www.reddit.com/search.json?q=${encoded}&sort=new&t=week&limit=50`;
      if (after) url += `&after=${after}`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for reddit video search "${query}" page ${page}`);
      }

      const json = await response.json();
      const children: RedditSearchChild[] = json?.data?.children || [];
      after = json?.data?.after || null;

      const validPosts = children.filter((child) => {
        if (!child.data?.permalink) return false;
        if (child.data.promoted || child.data.is_promoted) return false;
        if (child.kind && child.kind !== 't3') return false;
        return true;
      });

      for (const child of validPosts) {
        allItems.push(this.parseChild(child, query));
      }

      if (!after) break;
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Filter to video posts
    const videos = allItems.filter((item) => item.contentType === 'video');
    this.logger.log(`Reddit video search "${query}": ${allItems.length} total, ${videos.length} videos`);
    return videos;
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
