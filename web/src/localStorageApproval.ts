// Single approval switch that gates the ENTIRE B-index layer.
//
// Local persistent storage of upstream-derived data (a POI index built
// from real API responses, checked into git or bundled at build time) is
// a different compliance posture from this project's default (B-live:
// zero persistence, everything request-scoped). B-index is therefore
// switched on by exactly ONE flag, tied to local-storage approval status
// — never a separate "did we remember to remove the index" step.
//
// If approval is denied: this flag stays false forever, the index
// generator script is simply never run again, and NOTHING ELSE CHANGES —
// no code deletion, no user-visible behavior change (B-live already
// serves every screen). This is deliberate: consumer code must not need
// to know whether B-index exists at all (see match.ts callers in
// App.tsx/MapView.tsx, which call the same resolveAttraction()/
// buildPoiIndex() regardless of which layer supplied the POI array).
export const LOCAL_STORAGE_APPROVED = import.meta.env.VITE_LOCAL_STORAGE_APPROVED === "true";
