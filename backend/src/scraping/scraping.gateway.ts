import {
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
})
export class ScrapingGateway {
  private readonly logger = new Logger(ScrapingGateway.name);

  @WebSocketServer()
  server!: Server;

  emitScanStarted(data: { scanId: string; timestamp: string }) {
    this.server.emit('scan:started', data);
  }

  emitScanProgress(data: {
    source: string;
    platform: string;
    status: 'fetching' | 'complete' | 'error';
    itemsFound: number;
    current: number;
    total: number;
  }) {
    this.server.emit('scan:progress', data);
  }

  emitScanComplete(data: {
    itemsFound: number;
    newItems: number;
    errors: any[];
    duration: number;
    storeId?: string;
    storeName?: string;
  }) {
    this.server.emit('scan:complete', data);
  }

  emitScanError(data: { source?: string; error: string }) {
    this.server.emit('scan:error', data);
  }

  emitCurateStarted(data: { timestamp: string }) {
    this.server.emit('curate:started', data);
  }

  emitClusteringProgress(data: {
    phase: string;
    batch?: number;
    totalBatches?: number;
    itemsProcessed: number;
    totalItems: number;
  }) {
    this.server.emit('curate:clustering', data);
  }

  emitCurateComplete(data: { itemsScored: number; clustersCreated: number; duration: number }) {
    this.server.emit('curate:complete', data);
  }

  emitQuickSearchStarted(data: { query: string; timestamp: string }) {
    this.server.emit('quicksearch:started', data);
  }

  emitQuickSearchProgress(data: {
    source: string;
    platform: string;
    status: 'fetching' | 'complete' | 'error';
    itemsFound: number;
    current: number;
    total: number;
  }) {
    this.server.emit('quicksearch:progress', data);
  }

  emitQuickSearchComplete(data: { query: string; itemsFound: number; duration: number; storeId?: string; storeName?: string }) {
    this.server.emit('quicksearch:complete', data);
  }

  emitScanCancelled() {
    this.server.emit('scan:cancelled', {});
  }

  emitCurateCancelled() {
    this.server.emit('curate:cancelled', {});
  }

  emitQuickSearchCancelled() {
    this.server.emit('quicksearch:cancelled', {});
  }

  emitFeedUpdated() {
    this.server.emit('feed:updated', {});
  }
}
