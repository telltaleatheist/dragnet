import { Injectable, Logger } from '@nestjs/common';
import { BaseSource, RawContentItem } from './base-source';
import type { WebRssSourceConfig } from '../../../../shared/types';

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

@Injectable()
export class WebRssSource extends BaseSource {
  protected readonly logger = new Logger(WebRssSource.name);
  readonly platform = 'web';

  async fetch(config: WebRssSourceConfig): Promise<RawContentItem[]> {
    if (!config.enabled) return [];
    this.deadSources = [];

    const { XMLParser } = await import('fast-xml-parser');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '$',
      processEntities: true,
      htmlEntities: true,
      unpairedTags: ['hr', 'br', 'link', 'meta', 'img', 'input', 'source'],
      maxNestedTags: 500,
    });
    const items: RawContentItem[] = [];

    for (const feed of config.feeds) {
      try {
        const feedItems = await this.fetchFeed(parser, feed.url, feed.name);
        items.push(...feedItems);
      } catch (err) {
        const msg = (err as Error).message;
        this.logger.warn(`Failed to fetch RSS feed "${feed.name}": ${msg}`);

        // Mark permanently broken feeds as dead
        if (msg.includes('403') || msg.includes('fetch failed') || msg.includes('ENOTFOUND')) {
          this.deadSources.push({
            platform: 'web',
            sourceType: 'feed',
            value: feed.url,
            reason: msg.includes('403') ? 'blocked by Cloudflare or server' : 'domain unreachable',
          });
        }
      }
    }

    return items;
  }

  private async fetchFeed(
    parser: any,
    feedUrl: string,
    feedName: string,
  ): Promise<RawContentItem[]> {
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${feedUrl}`);
    }

    const xml = await response.text();

    // Some feeds have deeply nested or entity-heavy XML — use a lenient parse
    let parsed: any;
    try {
      parsed = parser.parse(xml);
    } catch (parseErr) {
      // Retry with a stripped-down version (remove CDATA, entities, etc.)
      const cleaned = xml
        .replace(/<!DOCTYPE[^>]*>/gi, '')
        .replace(/<!ENTITY[^>]*>/gi, '');
      try {
        parsed = parser.parse(cleaned);
      } catch {
        throw parseErr; // throw the original error
      }
    }

    // Handle both RSS and Atom formats
    const entries =
      parsed?.rss?.channel?.item ||
      parsed?.feed?.entry ||
      [];

    const entryList = Array.isArray(entries) ? entries : [entries];

    return entryList
      .filter((entry) => entry)
      .map((entry) => this.parseEntry(entry, feedName));
  }

  private parseEntry(entry: any, feedName: string): RawContentItem {
    const url = this.extractUrl(entry);
    const title = entry.title || '';
    const author = entry.author?.name || entry.author || entry['dc:creator'] || feedName;
    const content = entry['content:encoded'] || entry.content || entry.description || '';
    const published = entry.pubDate || entry.published || entry.updated || '';

    // Try to extract thumbnail from content or media tags
    let thumbnailUrl: string | undefined;
    if (entry['media:thumbnail']?.$url) {
      thumbnailUrl = entry['media:thumbnail'].$url;
    } else if (entry['media:content']?.$url) {
      thumbnailUrl = entry['media:content'].$url;
    } else {
      // Try to extract first image from content HTML
      const contentStr = typeof content === 'string' ? content : String(content || '');
      const imgMatch = contentStr.match(/<img[^>]+src=["']([^"']+)["']/);
      if (imgMatch) thumbnailUrl = imgMatch[1];
    }

    return {
      url: this.normalizeUrl(url),
      title: typeof title === 'string' ? title : String(title),
      author: typeof author === 'string' ? author : String(author),
      platform: 'web',
      contentType: 'article',
      textContent: this.truncateText(this.stripHtml(typeof content === 'string' ? content : String(content || ''))),
      publishedAt: published ? new Date(published).toISOString() : undefined,
      thumbnailUrl,
      sourceAccount: feedName,
      metadata: { feedName },
    };
  }

  private extractUrl(entry: any): string {
    if (typeof entry.link === 'string') return entry.link;
    if (entry.link?.$href) return entry.link.$href;
    if (Array.isArray(entry.link)) {
      const alt = entry.link.find((l: any) => l.$rel === 'alternate');
      return alt?.$href || entry.link[0]?.$href || '';
    }
    if (entry.guid) {
      return typeof entry.guid === 'string' ? entry.guid : entry.guid._ || entry.guid['#text'] || '';
    }
    return '';
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
