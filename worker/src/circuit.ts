// Global daily circuit breaker for upstream calls.
//
// IMPORTANT: the dev-account quota is 1,000 calls/day TOTAL, shared between
// contest-judging verification traffic and normal production traffic. This
// breaker exists to make sure production usage can never exhaust the quota
// before judges verify call history, and to fail loudly instead of silently
// degrading once the quota is nearly gone.
//
// Isolate caveat: like the rate limiter, this counter is per-isolate
// in-memory state (see rate-limit.ts for the full explanation). Cloudflare
// may run multiple isolates concurrently, so the *effective* global ceiling
// across all isolates can exceed these numbers. This is a best-effort budget
// guard, not a hard distributed guarantee. A durable/central counter (e.g.
// Durable Objects) would be needed for an exact global count; out of scope
// for this scaffold.

const WARN_THRESHOLD = 490;
const BLOCK_THRESHOLD = 700;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

interface CircuitState {
  count: number;
  /** KST calendar day this counter belongs to, as YYYY-MM-DD. */
  day: string;
}

let state: CircuitState = { count: 0, day: currentKstDay() };

function currentKstDay(): string {
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  return kstNow.toISOString().slice(0, 10);
}

function rollIfNewDay(): void {
  const today = currentKstDay();
  if (state.day !== today) {
    state = { count: 0, day: today };
  }
}

export type CircuitStatus = "ok" | "warn" | "blocked";

export function circuitStatus(): { status: CircuitStatus; count: number; day: string } {
  rollIfNewDay();
  if (state.count >= BLOCK_THRESHOLD) return { status: "blocked", count: state.count, day: state.day };
  if (state.count >= WARN_THRESHOLD) return { status: "warn", count: state.count, day: state.day };
  return { status: "ok", count: state.count, day: state.day };
}

/** Call BEFORE issuing an upstream request. Throws if blocked. */
export function assertCircuitOpen(): { status: CircuitStatus; count: number } {
  const s = circuitStatus();
  if (s.status === "blocked") {
    throw new Error(`circuit breaker open: ${s.count} upstream calls today (>= ${BLOCK_THRESHOLD}), further upstream calls are blocked until KST midnight reset`);
  }
  return s;
}

/** Call AFTER an upstream request completes (success or failure) to record it. */
export function recordUpstreamCall(): void {
  rollIfNewDay();
  state.count += 1;
}

export function resetCircuitForTests(): void {
  state = { count: 0, day: currentKstDay() };
}

export const CIRCUIT_WARN_THRESHOLD = WARN_THRESHOLD;
export const CIRCUIT_BLOCK_THRESHOLD = BLOCK_THRESHOLD;
