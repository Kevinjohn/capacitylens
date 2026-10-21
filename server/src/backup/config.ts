/**
 * Configures the directory, cadence, and retention count for snapshot files.
 */
export interface BackupConfig {
  dir: string;
  /** Snapshot cadence in minutes (CAPACITYLENS_BACKUP_INTERVAL_MIN, default 60). */
  intervalMin: number;
  /** Rolling retention count, oldest pruned (CAPACITYLENS_BACKUP_KEEP, default 48). */
  keep: number;
}
/**
 * Upper bound applied to the configured scheduled snapshot interval.
 */
export const MAX_BACKUP_INTERVAL_MIN = 35_000;
/**
 * Upper bound applied to the number of retained snapshot files.
 */
export const MAX_BACKUP_KEEP = 10_000;

interface ReportSubstitutionInput {
  name: string;
  raw: string;
  applied: number;
  bound: string;
}

type ReportSubstitution = (input: ReportSubstitutionInput) => void;

function createSubstitutionReporter(log: (message: string) => void): ReportSubstitution {
  return ({ name, raw, applied, bound }) => {
    log(
      `capacitylens-server: backup configuration warning — ${name} requested ${JSON.stringify(raw)}; applied ${applied} (${bound}).`,
    );
  };
}

interface ParseBoundedNumberInput {
  name: string;
  raw: string | undefined;
  fallback: number;
  max: number;
  reportSubstitution: ReportSubstitution;
}

function parseBoundedInteger({ name, raw, fallback, max, reportSubstitution }: ParseBoundedNumberInput): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    reportSubstitution({ name, raw, applied: fallback, bound: `valid range 1..${max}; using default` });
    return fallback;
  }
  if (parsed > max) reportSubstitution({ name, raw, applied: max, bound: `maximum ${max}` });
  return Math.min(parsed, max);
}

function parseBoundedFloor({ name, raw, fallback, max, reportSubstitution }: ParseBoundedNumberInput): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  const floored = Math.floor(parsed);
  if (!Number.isSafeInteger(floored) || floored < 1) {
    reportSubstitution({ name, raw, applied: fallback, bound: `valid range 1..${max}; using default` });
    return fallback;
  }
  if (parsed !== floored)
    reportSubstitution({ name, raw, applied: Math.min(floored, max), bound: "fractional value floored" });
  else if (floored > max) reportSubstitution({ name, raw, applied: max, bound: `maximum ${max}` });
  return Math.min(floored, max);
}

/** Fail-closed env parse: no CAPACITYLENS_BACKUP_DIR ⇒ null ⇒ backups don't exist. The numeric
 * knobs are only read when backups are on; junk/low values use the documented defaults while
 * over-limit values clamp to the published operator-safety ceiling. */
export function parseBackupConfig(
  environment: Record<string, string | undefined>,
  log: (message: string) => void = () => {},
): BackupConfig | null {
  const dir = environment.CAPACITYLENS_BACKUP_DIR;
  if (!dir) return null;
  const reportSubstitution = createSubstitutionReporter(log);
  return {
    dir,
    intervalMin: parseBoundedInteger({
      name: "CAPACITYLENS_BACKUP_INTERVAL_MIN",
      raw: environment.CAPACITYLENS_BACKUP_INTERVAL_MIN,
      fallback: 60,
      max: MAX_BACKUP_INTERVAL_MIN,
      reportSubstitution,
    }),
    // Released compatibility contract: a bounded fractional retention value means its floor. Do
    // not route it through the whole-minute parser above: falling back from e.g. 100.5 to 48 would
    // silently prune 52 restore points the operator asked to keep.
    keep: parseBoundedFloor({
      name: "CAPACITYLENS_BACKUP_KEEP",
      raw: environment.CAPACITYLENS_BACKUP_KEEP,
      fallback: 48,
      max: MAX_BACKUP_KEEP,
      reportSubstitution,
    }),
  };
}
/**
 * Formats the startup failure with the backup path and the underlying filesystem detail.
 */
export function formatBackupStartupFailure(dir: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `CAPACITYLENS_BACKUP_DIR=${JSON.stringify(dir)} could not be initialized: ${detail}. Fix the path and permissions, or set CAPACITYLENS_BACKUP_DIR= to disable scheduled backups.`;
}
