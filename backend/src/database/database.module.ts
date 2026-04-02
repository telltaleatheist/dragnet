import { Module, Global } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { ItemsService } from './items.service';
import { ScanHistoryService } from './scan-history.service';
import { SourceStatusService } from './source-status.service';

@Global()
@Module({
  providers: [
    DatabaseService,
    ItemsService,
    ScanHistoryService,
    SourceStatusService,
  ],
  exports: [
    DatabaseService,
    ItemsService,
    ScanHistoryService,
    SourceStatusService,
  ],
})
export class DatabaseModule {}
