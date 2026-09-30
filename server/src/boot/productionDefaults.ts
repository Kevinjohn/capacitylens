import { dirname, join } from "node:path";

type Environment = Record<string, string | undefined>;

// Defaults a production instance would otherwise refuse to boot without (or boot without the
// control). They are written into the environment before the posture guard and every parser read
// it, so the guard and the runtime always agree on one value. An explicit value, including an
// explicitly empty one, always wins: only an unset variable is filled in.
const UNSET_DEFAULTS: ReadonlyArray<readonly [string, string]> = [
  ["CAPACITYLENS_RATE_LIMIT", "300"],
  ["CAPACITYLENS_LOG", "1"],
  ["CAPACITYLENS_HEALTH_DEEP", "1"],
  ["CAPACITYLENS_AUDIT_STDOUT", "1"],
];

/** Directory of a file-backed database, or null for an in-memory or URI database. */
function databaseDirectory(databasePath: string): string | null {
  if (databasePath === "" || databasePath === ":memory:" || databasePath.startsWith("file:")) return null;
  return dirname(databasePath);
}

/**
 * Fill production defaults into `environment` (mutating it). No-op unless NODE_ENV=production.
 * The sign-in mode is the one value an empty string also counts as unset for, because the mode
 * parser already reads an empty string as unset.
 */
export function applyProductionDefaults(environment: Environment): void {
  if (environment.NODE_ENV !== "production") return;
  for (const [name, value] of UNSET_DEFAULTS) environment[name] ??= value;
  if (environment.SMALLSASS_ACCOUNT_MODE === undefined || environment.SMALLSASS_ACCOUNT_MODE === "") {
    environment.SMALLSASS_ACCOUNT_MODE = "password-only";
  }
  if (environment.CAPACITYLENS_BACKUP_DIR === undefined) {
    const directory = databaseDirectory(environment.CAPACITYLENS_DB ?? "capacitylens.db");
    if (directory !== null) environment.CAPACITYLENS_BACKUP_DIR = join(directory, "backups");
  }
}

/**
 * Whether the HSTS header is emitted: an explicit CAPACITYLENS_HTTPS of "1" or "0" decides;
 * otherwise the browser-facing public URL's scheme does.
 */
export function resolveHttps(environment: Environment): boolean {
  const explicit = environment.CAPACITYLENS_HTTPS;
  if (explicit === "1") return true;
  if (explicit === "0") return false;
  return /^https:\/\//i.test(environment.SMALLSASS_ACCOUNT_PUBLIC_URL ?? "");
}
