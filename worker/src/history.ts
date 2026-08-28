// In-memory call-history ledger — this is the evidence trail contest judges
// cross-check against the applicant's real upstream call log. Tracks
// per-operation, per-day call counts and response-code distribution, and
// confirms MobileApp was always the contest app name. Never stores the key.

export interface HistoryEntry {
  day: string; // KST YYYY-MM-DD
  operation: string;
  mobileApp: string;
  resultCode: string | "ERROR";
}

const MAX_ENTRIES = 5000;
const entries: HistoryEntry[] = [];

export function recordHistory(entry: HistoryEntry): void {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

export interface HistorySummary {
  day: string;
  operation: string;
  count: number;
  resultCodes: Record<string, number>;
  mobileAppValues: string[];
}

export function summarizeHistory(): HistorySummary[] {
  const map = new Map<string, HistorySummary>();
  for (const e of entries) {
    const key = `${e.day}::${e.operation}`;
    let s = map.get(key);
    if (!s) {
      s = { day: e.day, operation: e.operation, count: 0, resultCodes: {}, mobileAppValues: [] };
      map.set(key, s);
    }
    s.count += 1;
    s.resultCodes[e.resultCode] = (s.resultCodes[e.resultCode] ?? 0) + 1;
    if (!s.mobileAppValues.includes(e.mobileApp)) s.mobileAppValues.push(e.mobileApp);
  }
  return Array.from(map.values());
}

export function historyClearForTests(): void {
  entries.length = 0;
}
