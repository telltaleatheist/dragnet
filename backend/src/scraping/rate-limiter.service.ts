import { Injectable } from '@nestjs/common';

@Injectable()
export class RateLimiterService {
  private lastRequestTime = 0;

  async wait(delayMs: number): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs - elapsed));
    }
    this.lastRequestTime = Date.now();
  }
}
