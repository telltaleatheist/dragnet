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
}

export interface ScanStatus {
  running: boolean;
  lastScan: ScanRecord | null;
}

export interface ScanRecord {
  id: number;
  started_at: string;
  completed_at: string | null;
  items_found: number;
  new_items: number;
  items_scored: number;
  errors: string | null;
  status: string;
}

export interface SourceStatusRecord {
  source_key: string;
  platform: string;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  consecutive_failures: number;
  total_items_fetched: number;
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
}
