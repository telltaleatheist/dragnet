import { Component, Input, inject, signal, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../services/api.service';
import {
  SourcesConfig,
  TwitterSourceConfig,
  RedditSourceConfig,
  RedditTopTimeframe,
  YouTubeSourceConfig,
  YouTubeChannel,
  TikTokSourceConfig,
  WebRssSourceConfig,
  RssFeed,
  DiscoverySourceConfig,
} from '../../../../../../shared/types';

@Component({
  selector: 'app-sources-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sources-settings.component.html',
  styleUrl: './sources-settings.component.scss',
})
export class SourcesSettingsComponent implements OnChanges {
  @Input() config: any;

  private api = inject(ApiService);

  // Platform enabled states
  twitterEnabled = signal(true);
  redditEnabled = signal(true);
  youtubeEnabled = signal(true);
  tiktokEnabled = signal(false);
  webRssEnabled = signal(true);
  redditSearchEnabled = signal(true);
  googleNewsEnabled = signal(true);
  tiktokDiscoveryEnabled = signal(false);
  instagramDiscoveryEnabled = signal(false);

  // Source lists
  twitterAccounts = signal<string[]>([]);
  subreddits = signal<string[]>([]);
  redditFeedTypes = signal<('new' | 'top' | 'hot' | 'rising')[]>(['hot', 'top']);
  redditTopTimeframe = signal<RedditTopTimeframe>('week');
  youtubeChannels = signal<YouTubeChannel[]>([]);
  tiktokAccounts = signal<string[]>([]);
  tiktokHashtags = signal<string[]>([]);
  rssFeeds = signal<RssFeed[]>([]);

  // Add-form models
  newTwitterAccount = '';
  newSubreddit = '';
  newYoutubeChannelName = '';
  newYoutubeChannelId = '';
  newRssFeedName = '';
  newRssFeedUrl = '';
  newTiktokAccount = '';
  newTiktokHashtag = '';

  // Save state
  saving = signal(false);
  saved = signal(false);

  ngOnChanges(changes: SimpleChanges) {
    if (changes['config'] && this.config?.sources) {
      const s: SourcesConfig = this.config.sources;
      this.twitterEnabled.set(s.twitter.enabled);
      this.twitterAccounts.set([...s.twitter.accounts]);
      this.redditEnabled.set(s.reddit.enabled);
      this.subreddits.set([...s.reddit.subreddits]);
      this.redditFeedTypes.set([...s.reddit.feedTypes]);
      this.redditTopTimeframe.set(s.reddit.topTimeframe ?? 'week');
      this.youtubeEnabled.set(s.youtube.enabled);
      this.youtubeChannels.set(s.youtube.channels.map(c => ({ ...c })));
      this.tiktokEnabled.set(s.tiktok.enabled);
      this.tiktokAccounts.set([...s.tiktok.accounts]);
      this.tiktokHashtags.set([...s.tiktok.hashtags]);
      this.webRssEnabled.set(s.webRss.enabled);
      this.rssFeeds.set(s.webRss.feeds.map(f => ({ ...f })));
      this.redditSearchEnabled.set(s.redditSearch?.enabled ?? true);
      this.googleNewsEnabled.set(s.googleNews?.enabled ?? true);
      this.tiktokDiscoveryEnabled.set(s.tiktokDiscovery?.enabled ?? false);
      this.instagramDiscoveryEnabled.set(s.instagramDiscovery?.enabled ?? false);
    }
  }

  // --- Twitter ---
  addTwitterAccount() {
    const val = this.newTwitterAccount.trim().replace(/^@/, '');
    if (!val || this.twitterAccounts().includes(val)) return;
    this.twitterAccounts.update(list => [...list, val]);
    this.newTwitterAccount = '';
  }

  removeTwitterAccount(account: string) {
    this.twitterAccounts.update(list => list.filter(a => a !== account));
  }

  // --- Reddit ---
  addSubreddit() {
    const val = this.newSubreddit.trim().replace(/^r\//, '');
    if (!val || this.subreddits().includes(val)) return;
    this.subreddits.update(list => [...list, val]);
    this.newSubreddit = '';
  }

  removeSubreddit(sub: string) {
    this.subreddits.update(list => list.filter(s => s !== sub));
  }

  toggleFeedType(type: 'new' | 'top' | 'hot' | 'rising') {
    this.redditFeedTypes.update(types => {
      if (types.includes(type)) {
        return types.length > 1 ? types.filter(t => t !== type) : types;
      }
      return [...types, type];
    });
  }

  // --- YouTube ---
  addYoutubeChannel() {
    const name = this.newYoutubeChannelName.trim();
    const id = this.newYoutubeChannelId.trim();
    if (!name || !id) return;
    if (this.youtubeChannels().some(c => c.channelId === id)) return;
    this.youtubeChannels.update(list => [...list, { name, channelId: id }]);
    this.newYoutubeChannelName = '';
    this.newYoutubeChannelId = '';
  }

  removeYoutubeChannel(channelId: string) {
    this.youtubeChannels.update(list => list.filter(c => c.channelId !== channelId));
  }

  // --- RSS ---
  addRssFeed() {
    const name = this.newRssFeedName.trim();
    const url = this.newRssFeedUrl.trim();
    if (!name || !url) return;
    if (this.rssFeeds().some(f => f.url === url)) return;
    this.rssFeeds.update(list => [...list, { name, url }]);
    this.newRssFeedName = '';
    this.newRssFeedUrl = '';
  }

  removeRssFeed(url: string) {
    this.rssFeeds.update(list => list.filter(f => f.url !== url));
  }

  // --- TikTok ---
  addTiktokAccount() {
    const val = this.newTiktokAccount.trim().replace(/^@/, '');
    if (!val || this.tiktokAccounts().includes(val)) return;
    this.tiktokAccounts.update(list => [...list, val]);
    this.newTiktokAccount = '';
  }

  removeTiktokAccount(account: string) {
    this.tiktokAccounts.update(list => list.filter(a => a !== account));
  }

  addTiktokHashtag() {
    const val = this.newTiktokHashtag.trim().replace(/^#/, '');
    if (!val || this.tiktokHashtags().includes(val)) return;
    this.tiktokHashtags.update(list => [...list, val]);
    this.newTiktokHashtag = '';
  }

  removeTiktokHashtag(tag: string) {
    this.tiktokHashtags.update(list => list.filter(t => t !== tag));
  }

  // --- Save ---
  save() {
    this.saving.set(true);
    this.saved.set(false);

    const sources: SourcesConfig = {
      twitter: {
        enabled: this.twitterEnabled(),
        accounts: this.twitterAccounts(),
      },
      reddit: {
        enabled: this.redditEnabled(),
        subreddits: this.subreddits(),
        feedTypes: this.redditFeedTypes(),
        topTimeframe: this.redditTopTimeframe(),
      },
      youtube: {
        enabled: this.youtubeEnabled(),
        channels: this.youtubeChannels(),
      },
      tiktok: {
        enabled: this.tiktokEnabled(),
        accounts: this.tiktokAccounts(),
        hashtags: this.tiktokHashtags(),
      },
      webRss: {
        enabled: this.webRssEnabled(),
        feeds: this.rssFeeds(),
      },
      redditSearch: {
        enabled: this.redditSearchEnabled(),
      },
      googleNews: {
        enabled: this.googleNewsEnabled(),
      },
      tiktokDiscovery: {
        enabled: this.tiktokDiscoveryEnabled(),
      },
      instagramDiscovery: {
        enabled: this.instagramDiscoveryEnabled(),
      },
      substackDiscovery: {
        enabled: true,
      },
      twitterDiscovery: {
        enabled: true,
      },
    };

    this.api.updateConfig({ sources }).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      },
      error: () => this.saving.set(false),
    });
  }
}
