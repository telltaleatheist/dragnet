import { Module, Global } from '@nestjs/common';
import { InMemoryStoreService } from './in-memory-store.service';

@Global()
@Module({
  providers: [InMemoryStoreService],
  exports: [InMemoryStoreService],
})
export class StoreModule {}
