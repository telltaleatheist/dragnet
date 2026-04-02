// Shared types used by backend, frontend, and electron

// === Enums / Literals ===

export type Platform = 'twitter' | 'reddit' | 'youtube' | 'tiktok' | 'web';
export type ContentType = 'text' | 'video' | 'article' | 'image';
export type ScanState = 'idle' | 'scanning' | 'scoring' | 'completed' | 'failed';
export type FigureTier = 'top_priority' | 'high_priority' | 'monitor';
export type AIProviderType = 'ollama' | 'claude' | 'openai';

// === Content Items ===

export interface ContentItem {
  id: string;
  url: string;
  title: string;
  author: string;
  platform: Platform;
  contentType: ContentType;
  textContent?: string;
  publishedAt?: string;
  fetchedAt: string;
  thumbnailUrl?: string;
  sourceAccount: string;
  metadata?: Record<string, unknown>;
}

export interface ScoredItem extends ContentItem {
  preFilterScore: number;
  aiScore: number;
  aiTags: string[];
  aiSummary: string;
  aiClipType?: string;
  aiReasoning?: string;
  scoredAt?: string;
  aiProvider?: string;
  aiModel?: string;
  dismissed: boolean;
  bookmarked: boolean;
  opened: boolean;
}

// === Scanning ===

export interface ScanStatus {
  state: ScanState;
  startedAt?: string;
  progress?: ScanProgress;
  lastResult?: ScanResult;
}

export interface ScanProgress {
  current: number;
  total: number;
  currentSource?: string;
  currentPlatform?: Platform;
}

export interface ScanResult {
  scanId: string;
  itemsFound: number;
  newItems: number;
  itemsScored: number;
  errors: SourceError[];
  duration: number;
}

export interface SourceError {
  source: string;
  platform: Platform;
  error: string;
}

// === Source Status ===

export interface SourceStatus {
  sourceKey: string;
  platform: Platform;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastErrorMessage?: string;
  consecutiveFailures: number;
  totalItemsFetched: number;
}

// === Feed ===

export interface FeedFilters {
  page?: number;
  limit?: number;
  minScore?: number;
  maxScore?: number;
  platform?: Platform;
  tag?: string;
  contentType?: ContentType;
  bookmarked?: boolean;
  dismissed?: boolean;
  search?: string;
}

export interface FeedResponse {
  items: ScoredItem[];
  total: number;
  page: number;
  pageSize: number;
}

// === Configuration ===

export interface DragnetConfig {
  sources: SourcesConfig;
  scoring: ScoringConfig;
  subjects: SubjectProfile[];
  figures: FigureProfile[];
  settings: AppSettings;
}

export interface SourcesConfig {
  twitter: TwitterSourceConfig;
  reddit: RedditSourceConfig;
  youtube: YouTubeSourceConfig;
  tiktok: TikTokSourceConfig;
  webRss: WebRssSourceConfig;
  redditSearch: DiscoverySourceConfig;
  googleNews: DiscoverySourceConfig;
}

export interface DiscoverySourceConfig {
  enabled: boolean;
}

export interface TwitterSourceConfig {
  enabled: boolean;
  accounts: string[];
}

export type RedditTopTimeframe = 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';

export interface RedditSourceConfig {
  enabled: boolean;
  subreddits: string[];
  feedTypes: ('new' | 'top' | 'hot' | 'rising')[];
  topTimeframe: RedditTopTimeframe;
}

export interface YouTubeSourceConfig {
  enabled: boolean;
  channels: YouTubeChannel[];
}

export interface YouTubeChannel {
  name: string;
  channelId: string;
}

export interface TikTokSourceConfig {
  enabled: boolean;
  accounts: string[];
  hashtags: string[];
}

export interface WebRssSourceConfig {
  enabled: boolean;
  feeds: RssFeed[];
}

export interface RssFeed {
  name: string;
  url: string;
}

export interface ScoringConfig {
  aiProvider: AIProviderType;
  aiModel: string;
  ollamaEndpoint: string;
  claudeApiKey?: string;
  openaiApiKey?: string;
  batchSize: number;
  weights: ScoringWeights;
}

export interface ScoringWeights {
  videoBoost: number;
  figureBoosts: Record<FigureTier, number>;
  recencyDecayDays: number;
}

export interface SubjectProfile {
  id: string;
  label: string;
  color: string;
  keywords: string[];
  enabled: boolean;
  priority: number;
}

export interface FigureProfile {
  name: string;
  aliases: string[];
  tier: FigureTier;
  subjects: string[];
}

export interface AppSettings {
  requestDelayMs: number;
  maxResultsPerSource: number;
  autoScanIntervalMinutes: number;
  autoScanEnabled: boolean;
  maxItemAgeDays: number;
  feedPageSize: number;
  minScoreToShow: number;
}

// === WebSocket Events ===

export interface ScanStartedEvent {
  scanId: string;
  timestamp: string;
}

export interface ScanProgressEvent {
  source: string;
  platform: Platform;
  status: 'fetching' | 'complete' | 'error';
  itemsFound: number;
  current: number;
  total: number;
}

export interface ScanScoringEvent {
  batch: number;
  totalBatches: number;
  itemsScored: number;
}

export interface ScanCompleteEvent {
  scanId: string;
  itemsFound: number;
  newItems: number;
  itemsScored: number;
  errors: SourceError[];
  duration: number;
}

export interface ScanErrorEvent {
  source?: string;
  error: string;
}

// === AI Provider ===

export interface AIProviderConfig {
  provider: AIProviderType;
  model: string;
  apiKey?: string;
  ollamaEndpoint?: string;
}

export interface AIResponse {
  text: string;
  tokensUsed?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
  provider: string;
  model: string;
}
