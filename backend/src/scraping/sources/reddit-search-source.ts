import { Injectable, Logger } from '@nestjs/common';
import { BaseSource, RawContentItem } from './base-source';
import type { DiscoverySourceConfig, SubjectProfile, FigureProfile } from '../../../../shared/types';

interface RedditSearchConfig extends DiscoverySourceConfig {
  subjects: SubjectProfile[];
  figures: FigureProfile[];
}

interface RedditSearchChild {
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
        const results = await this.searchReddit(query);
        items.push(...results);
      } catch (err) {
        this.logger.warn(`Reddit search "${query}" failed: ${(err as Error).message}`);
      }

      // 1s delay between queries to avoid rate limits
      await new Promise((r) => setTimeout(r, 1000));
    }

    return items;
  }

  private buildQueries(subjects: SubjectProfile[], figures: FigureProfile[]): string[] {
    const queries: string[] = [];

    // From enabled subjects: use the label
    for (const subject of subjects) {
      if (subject.enabled) {
        queries.push(subject.label);
      }
    }

    // From top_priority figures: use the name
    for (const figure of figures) {
      if (figure.tier === 'top_priority') {
        queries.push(figure.name);
      }
    }

    // Cap at 20 queries
    return queries.slice(0, 20);
  }

  private async searchReddit(query: string): Promise<RawContentItem[]> {
    const encoded = encodeURIComponent(query);
    const url = `https://www.reddit.com/search.json?q=${encoded}&sort=new&t=week&limit=10`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'dragnet/1.0 (content aggregator)' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for reddit search "${query}"`);
    }

    const json = await response.json();
    const children: RedditSearchChild[] = json?.data?.children || [];

    return children
      .filter((child) => child.data?.permalink)
      .map((child) => this.parseChild(child, query));
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
      sourceAccount: `search:${query}`,
      metadata: { subreddit: d.subreddit, searchQuery: query },
    };
  }

  private detectContentType(data: RedditSearchChild['data']): string {
    if (data.is_video || data.url?.includes('youtube.com') || data.url?.includes('youtu.be')) {
      return 'video';
    }
    if (data.url?.includes('i.redd.it') || data.url?.includes('imgur.com')) {
      return 'image';
    }
    if (data.domain && !data.domain.includes('reddit.com')) {
      return 'article';
    }
    return 'text';
  }
}
