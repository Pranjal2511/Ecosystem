export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  tryRemove(count = 1): boolean {
    this.refill();
    if (this.tokens < count) {
      return false;
    }
    this.tokens -= count;
    return true;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }
}

export class KeyedRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number
  ) {}

  allow(key: string): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(this.capacity, this.refillPerSecond / 1000);
      this.buckets.set(key, bucket);
    }
    return bucket.tryRemove();
  }
}
