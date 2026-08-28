// Centralized redaction so key material can never leak into logs, error
// messages, or responses regardless of call site.

export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has("serviceKey")) {
      u.searchParams.set("serviceKey", "***REDACTED***");
    }
    return u.toString();
  } catch {
    // Fallback: string-level scrub if URL parsing fails for any reason.
    return url.replace(/serviceKey=[^&\s]+/gi, "serviceKey=***REDACTED***");
  }
}

/** Scrubs any literal key-shaped hex blob (as a defense in depth) from arbitrary text. */
export function redactText(text: string, secret?: string): string {
  let out = text;
  if (secret && secret.length > 0) {
    out = out.split(secret).join("***REDACTED***");
  }
  // Defense in depth: data.go.kr service keys are long hex/url-safe tokens.
  out = out.replace(/[A-Za-z0-9%+/=]{40,}/g, (match) => (match === "***REDACTED***" ? match : "***REDACTED***"));
  return out;
}
