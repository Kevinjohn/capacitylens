import env from '#start/env'

/** Operator settings for periodic native SQLite snapshots. */
export interface BackupConfig {
  dir: string
  intervalMin: number
  keep: number
}

export const MAX_BACKUP_INTERVAL_MIN = 35_000
export const MAX_BACKUP_KEEP = 10_000

/** Parse the operator backup settings once, including bounded numeric values. */
export function parseBackupConfig(
  environment: Record<string, string | undefined>,
  log: (message: string) => void = () => {}
): BackupConfig | null {
  const dir = environment.CAPACITYLENS_BACKUP_DIR
  if (!dir) return null
  const parse = (name: string, fallback: number, max: number, floor: boolean) => {
    const raw = environment[name]
    if (raw === undefined) return fallback
    const number = Number(raw)
    const value = floor ? Math.floor(number) : number
    if (!Number.isSafeInteger(value) || value < 1) {
      log(
        `backup configuration warning: ${name} requested ${JSON.stringify(raw)}; using ${fallback}`
      )
      return fallback
    }
    const applied = Math.min(value, max)
    if (applied !== number)
      log(
        `backup configuration warning: ${name} requested ${JSON.stringify(raw)}; using ${applied}`
      )
    return applied
  }
  return {
    dir,
    intervalMin: parse('CAPACITYLENS_BACKUP_INTERVAL_MIN', 60, MAX_BACKUP_INTERVAL_MIN, false),
    keep: parse('CAPACITYLENS_BACKUP_KEEP', 48, MAX_BACKUP_KEEP, true),
  }
}

/** Include the configured path in a fatal startup diagnostic. */
export function formatBackupStartupFailure(dir: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `CAPACITYLENS_BACKUP_DIR=${JSON.stringify(dir)} could not be initialized: ${detail}. Fix the path and permissions, or set CAPACITYLENS_BACKUP_DIR= to disable scheduled backups.`
}

/** Use Lucid's selected connection so backups target the database the application opens. */
export function resolveBackupDatabasePath(config: {
  connection: string
  connections: Record<string, unknown>
}): string {
  const selected = config.connections[config.connection]
  if (!selected || typeof selected !== 'object' || !('connection' in selected))
    throw new Error('Backups require a configured SQLite connection')
  const settings = selected.connection
  if (!settings || typeof settings !== 'object' || !('filename' in settings))
    throw new Error('Backups require a file-backed SQLite database')
  const filename = settings.filename
  if (
    typeof filename !== 'string' ||
    !filename ||
    filename === ':memory:' ||
    /^file:.*(?:\?|&)mode=memory(?:&|$)/i.test(filename)
  )
    throw new Error('Backups require a file-backed SQLite database')
  return filename
}

const backupConfig = parseBackupConfig(
  {
    CAPACITYLENS_BACKUP_DIR: env.get('CAPACITYLENS_BACKUP_DIR'),
    CAPACITYLENS_BACKUP_INTERVAL_MIN: env.get('CAPACITYLENS_BACKUP_INTERVAL_MIN'),
    CAPACITYLENS_BACKUP_KEEP: env.get('CAPACITYLENS_BACKUP_KEEP'),
  },
  (message) => console.warn(message)
)

// The framework treats a null default export as a missing export.
export default { settings: backupConfig }
