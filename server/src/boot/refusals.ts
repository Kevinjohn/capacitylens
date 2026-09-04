import type { Db } from "../db";

// Print one clear "refusing to start" line and exit non-zero. Boot SHOULD crash on a bad
// precondition (we never limp along half-configured) — this just makes the failure legible to an
// operator instead of a raw stack, matching the framed AuthConfigError / resetForbidden paths.
export function refuseToStart(reason: string): never {
  console.error(`capacitylens-server: refusing to start — ${reason}`);
  process.exit(1);
}

// The small "resolve this boot option or refuse" guard repeated across several independent
// options below (each just parses/validates one env-derived value with no extra cleanup on
// failure). Larger boot phases that must also close the database or dispose signal handlers on
// failure keep their own explicit try/catch instead of this helper.
export function tryOrRefuse<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    refuseToStart(error instanceof Error ? error.message : String(error));
  }
}

// Best-effort close on a startup-refusal path: the original failure is what's reported to the
// operator (via refuseToStart), so a close failure here is a SECOND, surfaced-not-swallowed
// problem, never the one that wins the message. `candidate` may be unassigned (a failure before
// openDbConnection ran), hence the optional call.
export function closeDbSafely(candidate: Db | undefined): void {
  try {
    candidate?.close();
  } catch (closeError) {
    console.error("capacitylens-server: database close also failed during startup refusal", closeError);
  }
}

// Fail-closed PORT parse (mirrors parseRateLimit): a typo like PORT=abc or an out-of-range value
// must not silently fall through to a confusing app.listen error — reject it up front with a clear
// message. Unset → the 8787 default.
export function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 8787;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    refuseToStart(`PORT must be an integer 1..65535, got ${JSON.stringify(raw)}.`);
  }
  return n;
}

// Fail-SOFT numeric parse (mirrors parseBackupConfig's `positive`, not parsePort's refuseToStart):
// this only bounds the audit log's on-disk size, not a security-relevant gate, so a missing/junk
// value falls back to the documented 64 MiB default rather than refusing to boot.
export function parseAuditMaxMb(raw: string | undefined): number {
  const n = Number(raw);
  const maxMb = 1024 * 1024;
  return Number.isSafeInteger(n) && n >= 1 && n <= maxMb ? n : 64;
}
