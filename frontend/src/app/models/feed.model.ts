export interface FeedItem {
  id: string;
  url: string;
  title: string;
  author: string;
  platform: string;
  contentType: string;
  textContent: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  thumbnailUrl: string | null;
  sourceAccount: string;
  storeId?: string;
  metadata: Record<string, unknown> | null;
  preFilterScore: number;
  aiScore: number;
  aiTags: string[];
  aiSummary: string | null;
  aiClipType: string | null;
  aiReasoning: string | null;
  scoredAt: string | null;
  aiProvider: string | null;
  aiModel: string | null;
  dismissed: boolean;
  bookmarked: boolean;
  opened: boolean;
}

export interface FeedResponse {
  items: FeedItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FeedFilters {
  page: number;
  limit: number;
  minScore?: number;
  platform?: string;
  tag?: string;
  contentType?: string;
  bookmarked?: boolean;
  dismissed?: boolean;
  search?: string;
  storeIds?: string[];
}

export type DataStoreType = 'scan' | 'search' | 'browser-assist' | 'snapshot';

export interface DataStore {
  id: string;
  name: string;
  type: DataStoreType;
  createdAt: string;
  itemCount: number;
  searchTerms?: string[];
}

export interface SearchTermSet {
  id: string;
  name: string;
  topics: string[];
  figures: string[];
  suggestions: { text: string; enabled: boolean }[];
  createdAt: string;
}

export interface StoryCluster {
  id: string;
  title: string;
  summary: string;
  score: number;
  subjects: string[];
  items: FeedItem[];
  createdAt: string;
}

export interface CuratedResponse {
  clusters: StoryCluster[];
}

export interface ClusteringProgressEvent {
  phase: 'scoring' | 'clustering' | 'expanding';
  batch?: number;
  totalBatches?: number;
  itemsProcessed: number;
  totalItems: number;
}

export interface CurateCompleteEvent {
  itemsScored: number;
  clustersCreated: number;
  duration: number;
}

export interface ScanProgressEvent {
  source: string;
  platform: string;
  status: 'fetching' | 'complete' | 'error';
  itemsFound: number;
  current: number;
  total: number;
}

export interface ScanCompleteEvent {
  scanId: number;
  itemsFound: number;
  newItems: number;
  itemsScored: number;
  errors: any[];
  duration: number;
  storeId?: string;
  storeName?: string;
}

export interface SearchCompleteEvent {
  query: string;
  itemsFound: number;
  duration: number;
  storeId?: string;
  storeName?: string;
}

export interface BookmarkClusterSummary {
  clusterTitle: string;
  clusterSummary: string | null;
  itemCount: number;
  latestBookmarkedAt: string;
}

export interface BookmarkedClusterDetail {
  clusterTitle: string;
  clusterSummary: string | null;
  items: FeedItem[];
}
