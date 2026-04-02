import { Module, forwardRef } from '@nestjs/common';
import { ScrapingService } from './scraping.service';
import { ScrapingController } from './scraping.controller';
import { ScrapingGateway } from './scraping.gateway';
import { RateLimiterService } from './rate-limiter.service';
import { RedditSource } from './sources/reddit-source';
import { TwitterSource } from './sources/twitter-source';
import { YouTubeSource } from './sources/youtube-source';
import { WebRssSource } from './sources/web-rss-source';
import { RedditSearchSource } from './sources/reddit-search-source';
import { GoogleNewsSource } from './sources/google-news-source';
import { ScoringModule } from '../scoring/scoring.module';

@Module({
  imports: [ScoringModule],
  controllers: [ScrapingController],
  providers: [
    ScrapingService,
    ScrapingGateway,
    RateLimiterService,
    RedditSource,
    TwitterSource,
    YouTubeSource,
    WebRssSource,
    RedditSearchSource,
    GoogleNewsSource,
  ],
  exports: [ScrapingService, ScrapingGateway],
})
export class ScrapingModule {}
