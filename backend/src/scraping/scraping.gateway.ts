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

  emitScanStarted(data: { scanId: number; timestamp: string }) {
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

  emitScanSourceComplete(data: {
    source: string;
    platform: string;
    itemsFound: number;
    errors?: string;
  }) {
    this.server.emit('scan:source-complete', data);
  }

  emitScanScoring(data: {
    batch: number;
    totalBatches: number;
    itemsScored: number;
  }) {
    this.server.emit('scan:scoring', data);
  }

  emitScanComplete(data: {
    scanId: number;
    itemsFound: number;
    newItems: number;
    itemsScored: number;
    errors: any[];
    duration: number;
  }) {
    this.server.emit('scan:complete', data);
  }

  emitScanError(data: { source?: string; error: string }) {
    this.server.emit('scan:error', data);
  }

  emitCurateStarted(data: { timestamp: string }) {
    this.server.emit('curate:started', data);
  }

  emitCurateComplete(data: { itemsScored: number; duration: number }) {
    this.server.emit('curate:complete', data);
  }

  emitFeedUpdated() {
    this.server.emit('feed:updated', {});
  }
}
