import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { environment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { StoreModule } from './store/store.module';
import { DragnetConfigModule } from './config/dragnet-config.module';
import { ScrapingModule } from './scraping/scraping.module';
import { FeedModule } from './feed/feed.module';
import { ScoringModule } from './scoring/scoring.module';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [() => environment],
    }),
    EventEmitterModule.forRoot({
      global: true,
    }),
    DatabaseModule,
    StoreModule,
    DragnetConfigModule,
    ScrapingModule,
    ScoringModule,
    FeedModule,
    // Serve Angular frontend if FRONTEND_PATH is provided
    ...(process.env.FRONTEND_PATH
      ? [
          ServeStaticModule.forRoot({
            rootPath: process.env.FRONTEND_PATH,
            exclude: ['/api{/*path}', '/socket.io{/*path}'],
          }),
        ]
      : []),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
