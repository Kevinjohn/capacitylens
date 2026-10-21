import type { Db } from "../db";

// Print one clear "refusing to start" line and exit non-zero. Boot should crash on a bad
// precondition (we never limp along half-configured). This just makes the failure legible to an
// operator instead of a raw stack, matching the framed AuthConfigError / resetForbidden paths.
/**
 * Logs the startup refusal and exits with the repository’s fail-closed status.
 */
export function refuseToStart(reason: string): never {
  console.error(`capacitylens-server: refusing to start — ${reason}`);
  process.exit(1);
}

// The small "resolve this boot option or refuse" guard repeated across several independent
// options below (each just parses/validates one env-derived value with no extra cleanup on
// failure). Larger boot phases that must also close the database or dispose signal handlers on
// failure keep their own explicit try/catch instead of this helper.
/**
 * Runs startup work and converts a thrown failure into the standard refusal path.
 */
export function tryOrRefuse<T>(callback: () => T): T {
  try {
    return callback();
  } catch (error) {
    refuseToStart(error instanceof Error ? error.message : String(error));
  }
}

// Best-effort close on a startup-refusal path: the original failure is what's reported to the
// operator (via refuseToStart), so a close failure here is a second, surfaced-not-swallowed
// problem, never the one that wins the message. `candidate` may be unassigned (a failure before
// openDbConnection ran), hence the optional call.
/**
 * Attempts to close SQLite during startup recovery without hiding the original failure.
 */
export function closeDbSafely(candidate: Db | undefined): void {
  try {
    candidate?.close();
  } catch (closeError) {
    console.error("capacitylens-server: database close also failed during startup refusal", closeError);
  }
}

// Fail-closed PORT parse (mirrors parseRateLimit): a typo like PORT=abc or an out-of-range value
// must not silently fall through to a confusing app.listen error, reject it up front with a clear
// message. Unset → the 8787 default.
/**
 * Validates the configured listener port and returns its numeric value.
 */
export function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 8787;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    refuseToStart(`PORT must be an integer 1..65535, got ${JSON.stringify(raw)}.`);
  }
  return n;
}

// Invalid audit-size input falls back to 64 MiB so an optional size preference cannot prevent startup.
/** Parses the audit size limit, using the documented default for missing or invalid values. */
export function parseAuditMaxMb(raw: string | undefined): number {
  const n = Number(raw);
  const maxMb = 1024 * 1024;
  return Number.isSafeInteger(n) && n >= 1 && n <= maxMb ? n : 64;
}
