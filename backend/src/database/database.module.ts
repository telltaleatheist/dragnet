import { Module, Global } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { BookmarksService } from './bookmarks.service';

@Global()
@Module({
  providers: [
    DatabaseService,
    BookmarksService,
  ],
  exports: [
    DatabaseService,
    BookmarksService,
  ],
})
export class DatabaseModule {}
