'use strict';
/** Rate limiter token bucket per kunci (IP, pengguna, atau API key). Fungsi murni agar mudah diuji. */
class TokenBucketLimiter {
  constructor({ now = Date.now } = {}) { this.now = now; this.buckets = new Map(); }

  /** Mengembalikan { allowed, limit, remaining, retryAfterSeconds }. limitPerMin juga menjadi kapasitas bucket. */
  take(key, limitPerMin) {
    const t = this.now();
    const rate = limitPerMin / 60000;
    let b = this.buckets.get(key);
    if (!b) { b = { tokens: limitPerMin, at: t }; this.buckets.set(key, b); }
    b.tokens = Math.min(limitPerMin, b.tokens + (t - b.at) * rate);
    b.at = t;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { allowed: true, limit: limitPerMin, remaining: Math.floor(b.tokens), retryAfterSeconds: 0 };
    }
    return { allowed: false, limit: limitPerMin, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((1 - b.tokens) / rate / 1000)) };
  }

  sweep(maxIdleMs = 600000) {
    const t = this.now();
    for (const [k, b] of this.buckets) if (t - b.at > maxIdleMs) this.buckets.delete(k);
  }
}

module.exports = { TokenBucketLimiter };
