// In-memory TTL cache. No local persistence — this state is process/isolate
// lifetime only and disappears on eviction/restart, satisfying the
// "no local persistent storage" constraint.
//
// Only fully successful upstream responses are cached. Errors and partial
// responses are never cached, and on expiry the entry is dropped BEFORE
// re-fetching — if the re-fetch fails, the failure is surfaced to the
// caller rather than serving stale data.

const MAX_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface CacheEntry<T> {
  value: T;
  fetchedAt: number; // epoch ms
  expiresAt: number; // epoch ms
}

const store = new Map<string, CacheEntry<unknown>>();

export interface CacheGetResult<T> {
  value: T;
  fetchedAt: number;
}

export function cacheGet<T>(key: string): CacheGetResult<T> | undefined {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    // Expired: evict immediately so a failed refetch cannot fall back to stale data.
    store.delete(key);
    return undefined;
  }
  return { value: entry.value, fetchedAt: entry.fetchedAt };
}

export function cacheSet<T>(key: string, value: T, ttlMs: number = MAX_TTL_MS): void {
  const clampedTtl = Math.min(ttlMs, MAX_TTL_MS);
  const now = Date.now();
  store.set(key, { value, fetchedAt: now, expiresAt: now + clampedTtl });
}

export function cacheDelete(key: string): void {
  store.delete(key);
}

export function cacheClearForTests(): void {
  store.clear();
}

/**
 * Builds a cache key from the operation and ALL params that can affect the
 * response shape (everything the client controls, sorted for determinism).
 */
export function buildCacheKey(operation: string, params: Record<string, string>): string {
  const sortedEntries = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  const paramStr = sortedEntries.map(([k, v]) => `${k}=${v}`).join("&");
  return `${operation}?${paramStr}`;
}

export const CACHE_MAX_TTL_MS = MAX_TTL_MS;
