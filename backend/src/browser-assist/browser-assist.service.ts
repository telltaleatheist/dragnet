import { Injectable, Logger } from '@nestjs/common';
import { DragnetConfigService } from '../config/dragnet-config.service';
import { InMemoryStoreService } from '../store/in-memory-store.service';
import { ContentItem, Platform, ContentType } from '../../../shared/types';
import { v4 as uuidv4 } from 'uuid';

interface ParsedLine {
  url: string;
  description?: string;
}

@Injectable()
export class BrowserAssistService {
  private readonly logger = new Logger(BrowserAssistService.name);

  constructor(
    private readonly configService: DragnetConfigService,
    private readonly store: InMemoryStoreService,
  ) {}

  generatePrompts(
    platforms: string[],
    searchTerms?: string[],
    videoOnly?: boolean,
    adversarial?: boolean,
    maxAgeDays?: number,
  ): { prompts: { platform: string; prompt: string }[] } {
    const config = this.configService.getConfig();

    const subjects = config.subjects.map((s) => s.label).join(', ');
    const figures = config.figures.map((f) => f.name).join(', ');
    const extra = searchTerms?.length ? searchTerms.join(', ') : '';

    const prompts = platforms.map((platform) => ({
      platform,
      prompt: this.buildPrompt(platform, subjects, figures, extra, !!videoOnly, !!adversarial, maxAgeDays),
    }));

    return { prompts };
  }

  async importUrls(rawText: string): Promise<{ imported: number; skipped: number; storeId: string; storeName: string }> {
    const lines = this.parseLines(rawText);
    const baStore = this.store.createStore(`Browser Assist ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`, 'browser-assist');
    if (lines.length === 0) return { imported: 0, skipped: 0, storeId: baStore.id, storeName: baStore.name };

    this.logger.log(`Parsed ${lines.length} URLs from pasted text`);

    const items: ContentItem[] = [];

    for (const line of lines) {
      const platform = this.detectPlatform(line.url);
      const contentType = this.detectContentType(line.url, platform);
      let title = line.description || line.url;
      let author = '';
      let textContent: string | undefined;
      let publishedAt: string | undefined;
      let thumbnailUrl: string | undefined;
      let sourceAccount = '';

      // Enrich Reddit
      if (platform === 'reddit') {
        try {
          const enriched = await this.enrichReddit(line.url);
          if (enriched) {
            title = enriched.title || title;
            author = enriched.author || '';
            textContent = enriched.selftext;
            publishedAt = enriched.date;
            sourceAccount = enriched.subreddit ? `r/${enriched.subreddit}` : '';
          }
        } catch (err) {
          this.logger.warn(`Reddit enrich failed for ${line.url}: ${(err as Error).message}`);
        }
        // 500ms delay between Reddit requests
        await this.delay(500);
      }

      // Enrich Twitter
      if (platform === 'twitter') {
        try {
          const enriched = await this.enrichTwitter(line.url);
          if (enriched) {
            title = enriched.text?.slice(0, 120) || title;
            author = enriched.author || '';
            textContent = enriched.text;
            sourceAccount = enriched.username ? `@${enriched.username}` : '';
          }
        } catch (err) {
          this.logger.warn(`Twitter enrich failed for ${line.url}: ${(err as Error).message}`);
        }
        await this.delay(300);
      }

      // Enrich YouTube
      if (platform === 'youtube') {
        try {
          const enriched = await this.enrichYouTube(line.url);
          if (enriched) {
            title = enriched.title || title;
            author = enriched.author || '';
            thumbnailUrl = enriched.thumbnail;
          }
        } catch (err) {
          this.logger.warn(`YouTube enrich failed for ${line.url}: ${(err as Error).message}`);
        }
      }

      items.push({
        id: uuidv4(),
        url: line.url,
        title,
        author,
        platform,
        contentType,
        textContent,
        publishedAt,
        fetchedAt: new Date().toISOString(),
        thumbnailUrl,
        sourceAccount: sourceAccount || `browser-assist:${platform}`,
        metadata: { source: 'browser-assist' },
      });
    }

    // localDedup=true: only deduplicate within this BA store, not globally.
    // The user explicitly chose these URLs — don't silently discard them just
    // because the same URL appeared in a previous scan or search store.
    const added = this.store.addItems(items, baStore.id, true);
    const skipped = items.length - added;

    this.logger.log(`Browser Assist import: ${added} added, ${skipped} skipped (dedup)`);
    return { imported: added, skipped, storeId: baStore.id, storeName: baStore.name };
  }

  // --- Private helpers ---

  private buildPrompt(platform: string, subjects: string, figures: string, searchTerms: string, videoOnly: boolean, adversarial: boolean, maxAgeDays?: number): string {
    // When search terms exist (from Advanced Search), they're the primary focus.
    // Profile subjects/figures become background context.
    let intro: string;

    if (searchTerms) {
      intro = `I'm a journalist who produces debunking content about conspiracy theories and misinformation. I'm working on a piece about how certain ideas spread on ${platform}, and I need to understand what's actually being said within these communities.\n\nI'm researching: ${searchTerms}`;
    } else {
      const topicLine = subjects || 'misinformation and conspiracy theories';
      const figureLine = figures ? `\n\nKey people/accounts I'm interested in: ${figures}` : '';
      intro = `I'm a journalist/content creator who covers misinformation. I'm currently researching the following topics: ${topicLine}${figureLine}`;
    }

    const adversarialNote = adversarial
      ? `\n\nFor this project, I specifically need to see posts from within these communities — people who are sharing, discussing, and believing these ideas in their own words. I already have plenty of fact-checking and debunking material, so please focus on the community side: the conversations, claims, and content that people in these spaces are posting.`
      : '';

    const videoNote = videoOnly
      ? `\n\nI'm only looking for video content — posts with embedded video, video clips, or links to video. If a post is just text or an image, please skip it. Tip: on Twitter/X, the Media tab (?f=media) helps surface video posts — look for the duration badge to distinguish video from images.`
      : '';

    let dateNote = '';
    if (maxAgeDays) {
      const label = maxAgeDays <= 7 ? 'the past week' : maxAgeDays <= 30 ? 'the past month' : 'the past year';
      dateNote = `\n\nPlease only include content from ${label}. Skip anything older than that.`;
    }

    const formatSuffix = videoOnly ? ' (duration if visible)' : '';
    const format = `For each one, a link and a short note about what it covers would be great:`;

    const preamble = `${intro}${adversarialNote}${videoNote}${dateNote}`;

    switch (platform) {
      case 'twitter':
        return `${preamble}\n\nCan you help me find some recent examples on Twitter? ${format}\nhttps://x.com/... | brief description${formatSuffix}`;

      case 'reddit':
        return adversarial
          ? `${preamble}\n\nCan you help me browse Reddit for discussions within these communities? I'm looking for subreddits where these ideas are discussed seriously.\n\n${format}\nhttps://reddit.com/... | brief description${formatSuffix}`
          : `${preamble}\n\nCan you help me browse Reddit for recent discussions about these topics? Subreddits like r/conspiracy, r/DebunkThis, and related communities would be great places to check.\n\n${format}\nhttps://reddit.com/... | brief description${formatSuffix}`;

      case 'youtube':
        return `${preamble}\n\nCan you help me find some recent YouTube videos about these topics?\n\n${format}\nhttps://youtube.com/... | brief description${formatSuffix}`;

      case 'tiktok':
        return `${preamble}\n\nCan you help me find TikTok videos related to these topics?\n\n${format}\nhttps://tiktok.com/... | brief description${formatSuffix}`;

      case 'instagram':
        return `${preamble}\n\nCan you help me find Instagram posts and reels related to these topics?\n\n${format}\nhttps://instagram.com/... | brief description${formatSuffix}`;

      default:
        return `${preamble}\n\nCan you help me find recent content about these topics online?\n\n${format}`;
    }
  }


  private parseLines(rawText: string): ParsedLine[] {
    const seen = new Set<string>();
    const results: ParsedLine[] = [];

    for (const raw of rawText.split('\n')) {
      const line = raw.trim();
      if (!line.startsWith('http')) continue;

      // Split on " | " or " — " for optional description
      let url: string;
      let description: string | undefined;
      const pipeIdx = line.indexOf(' | ');
      const dashIdx = line.indexOf(' — ');

      if (pipeIdx !== -1) {
        url = line.slice(0, pipeIdx).trim();
        description = line.slice(pipeIdx + 3).trim();
      } else if (dashIdx !== -1) {
        url = line.slice(0, dashIdx).trim();
        description = line.slice(dashIdx + 3).trim();
      } else {
        url = line;
      }

      // Clean tracking params
      try {
        const u = new URL(url);
        u.searchParams.delete('utm_source');
        u.searchParams.delete('utm_medium');
        u.searchParams.delete('utm_campaign');
        u.searchParams.delete('s'); // Reddit share tracking
        u.searchParams.delete('t'); // Twitter share tracking
        url = u.toString();
      } catch {
        // If URL doesn't parse, use as-is
      }

      if (seen.has(url)) continue;
      seen.add(url);
      results.push({ url, description });
    }

    return results;
  }

  private detectPlatform(url: string): Platform {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
      if (hostname.includes('reddit.com')) return 'reddit';
      if (hostname.includes('youtube.com') || hostname === 'youtu.be') return 'youtube';
      if (hostname.includes('tiktok.com')) return 'tiktok';
      if (hostname.includes('instagram.com')) return 'instagram';
    } catch {}
    return 'web';
  }

  private detectContentType(url: string, platform: Platform): ContentType {
    if (platform === 'youtube' || platform === 'tiktok') return 'video';
    if (platform === 'instagram') {
      try {
        if (new URL(url).pathname.includes('/reel/')) return 'video';
      } catch {}
    }
    if (platform === 'reddit') {
      try {
        if (new URL(url).hostname.includes('v.redd.it')) return 'video';
      } catch {}
    }
    return 'article';
  }

  private async enrichReddit(url: string): Promise<{
    title?: string;
    author?: string;
    subreddit?: string;
    selftext?: string;
    date?: string;
  } | null> {
    // Normalize URL: ensure it doesn't end with .json already
    let jsonUrl = url.replace(/\/$/, '');
    if (!jsonUrl.endsWith('.json')) jsonUrl += '.json';

    const response = await fetch(jsonUrl, {
      headers: { 'User-Agent': 'Dragnet/1.0 (research tool)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const post = Array.isArray(data) ? data[0]?.data?.children?.[0]?.data : data?.data?.children?.[0]?.data;
    if (!post) return null;

    return {
      title: post.title,
      author: post.author,
      subreddit: post.subreddit,
      selftext: post.selftext?.slice(0, 2000),
      date: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : undefined,
    };
  }

  private async enrichYouTube(url: string): Promise<{
    title?: string;
    author?: string;
    thumbnail?: string;
  } | null> {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetch(oembedUrl, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const videoId = this.extractYouTubeVideoId(url);

    return {
      title: data.title,
      author: data.author_name,
      thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined,
    };
  }

  private async enrichTwitter(url: string): Promise<{
    text?: string;
    author?: string;
    username?: string;
  } | null> {
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&format=json&omit_script=true`;
    const response = await fetch(oembedUrl, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = await response.json();

    // Extract plain text from the HTML embed
    // oEmbed html looks like: <blockquote>...<p>tweet text</p>...&mdash; Author (@user)</blockquote>
    const text = this.stripHtmlTags(data.html || '')
      .replace(/\s*—\s*[^—]+$/, '')  // Remove the trailing "— Author (@user) date" line
      .trim();

    // Extract @username from author_url (e.g. "https://twitter.com/username")
    let username = '';
    if (data.author_url) {
      try {
        username = new URL(data.author_url).pathname.replace(/^\//, '');
      } catch {}
    }

    return {
      text: text || undefined,
      author: data.author_name || undefined,
      username: username || undefined,
    };
  }

  private stripHtmlTags(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&mdash;/g, '—')
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private extractYouTubeVideoId(url: string): string | null {
    try {
      const u = new URL(url);
      if (u.hostname === 'youtu.be') return u.pathname.slice(1);
      return u.searchParams.get('v') || u.pathname.match(/\/(?:shorts|embed|v)\/([^/?]+)/)?.[1] || null;
    } catch {
      return null;
    }
  }


  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
