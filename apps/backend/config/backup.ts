import env from '#start/env';
import { defineConfig, type BackupConfig } from '@kevinjohn/adonisjs-sqlite-backup';
export type { BackupConfig } from '@kevinjohn/adonisjs-sqlite-backup';

export const MAX_BACKUP_KEEP = 10_000;

/** Parse the operator backup settings once, including bounded retention. */
export function parseBackupConfig(
  environment: Record<string, string | undefined>,
  log: (message: string) => void = () => {}
): BackupConfig {
  const dir = environment.CAPACITYLENS_BACKUP_DIR;
  if (!dir) return defineConfig({ directory: dir });
  const raw = environment.CAPACITYLENS_BACKUP_KEEP;
  const parseKeep = () => {
    const fallback = 48;
    const name = 'CAPACITYLENS_BACKUP_KEEP';
    if (raw === undefined) return fallback;
    const number = Number(raw);
    const value = Math.floor(number);
    if (!Number.isSafeInteger(value) || value < 1) {
      log(
        `backup configuration warning: ${name} requested ${JSON.stringify(raw)}; using ${fallback}`
      );
      return fallback;
    }
    const applied = Math.min(value, MAX_BACKUP_KEEP);
    if (applied !== number)
      log(
        `backup configuration warning: ${name} requested ${JSON.stringify(raw)}; using ${applied}`
      );
    return applied;
  };
  return defineConfig({ directory: dir, keep: parseKeep() });
}

/** Include the configured path in a fatal startup diagnostic. */
export function formatBackupStartupFailure(dir: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `CAPACITYLENS_BACKUP_DIR=${JSON.stringify(dir)} could not be initialized: ${detail}. Fix the path and permissions, or set CAPACITYLENS_BACKUP_DIR= to disable scheduled backups.`;
}

const backupConfig = parseBackupConfig(
  {
    CAPACITYLENS_BACKUP_DIR: env.get('CAPACITYLENS_BACKUP_DIR'),
    CAPACITYLENS_BACKUP_KEEP: env.get('CAPACITYLENS_BACKUP_KEEP'),
  },
  (message) => console.warn(message)
);

export default backupConfig;
