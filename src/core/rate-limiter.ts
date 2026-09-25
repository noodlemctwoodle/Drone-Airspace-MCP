/**
 * Simple token bucket. `acquire()` resolves when a token is available.
 * Used to keep Nominatim at one request per second across the whole process.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number = 1,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
  ) {
    this.tokens = burst;
    this.lastRefill = now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = (t - this.lastRefill) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSecond);
      this.lastRefill = t;
    }
  }

  acquire(): Promise<void> {
    const next = this.queue.then(async () => {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil(((1 - this.tokens) / this.ratePerSecond) * 1000);
      await this.sleep(waitMs);
      this.refill();
      this.tokens = Math.max(0, this.tokens - 1);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}
