// Per-IP rate limiter.
//
// CAVEAT (read before relying on this for hard guarantees): Cloudflare
// Workers can run the same script across multiple isolates concurrently
// (e.g. across colos, or scaled up under load), and each isolate has its
// own independent copy of this in-memory Map. There is NO shared state
// between isolates here. This means the *effective* global rate limit for
// a given IP can be a multiple of the configured limit if requests land on
// different isolates. This is a best-effort, cheap first line of defense,
// not a precise distributed rate limiter. A correct distributed version
// would need Durable Objects or an external store (e.g. KV with atomic
// counters, or a rate-limiting service) — intentionally out of scope for
// this scaffold.

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;

interface Bucket {
  windowStart: number;
  count: number;
}

const buckets = new Map<string, Bucket>();

export function isRateLimited(clientIp: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(clientIp);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(clientIp, { windowStart: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_WINDOW;
}

export function rateLimitClearForTests(): void {
  buckets.clear();
}

export const RATE_LIMIT_WINDOW_MS = WINDOW_MS;
export const RATE_LIMIT_MAX = MAX_REQUESTS_PER_WINDOW;
