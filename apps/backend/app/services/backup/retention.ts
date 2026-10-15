import { readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { NativeDatabase } from './native.js'
import { SNAPSHOT_RE, parseSnapshotTimestamp, UTC_SNAPSHOT_RE } from './names.js'

/** Device and inode of the live SQLite file. */
export interface FileIdentity {
  path: string
  device: bigint
  inode: bigint
}

/** Capture the file actually opened by SQLite, including its inode for hard-link protection. */
export function readMainDatabaseIdentity(db: NativeDatabase): FileIdentity | null {
  const main = (
    db.prepare('PRAGMA database_list').all() as Array<{ name: string; file: string }>
  ).find((database) => database.name === 'main')
  if (!main?.file) return null
  const path = resolve(main.file)
  try {
    const stat = statSync(path, { bigint: true })
    return { path, device: stat.dev, inode: stat.ino }
  } catch (cause) {
    throw new Error(
      `Could not identify the live SQLite database at "${path}" for safe retention.`,
      {
        cause,
      }
    )
  }
}

/** Protect the source database and its hard-link aliases from retention. */
export function isProtectedDatabasePath(path: string, database: FileIdentity | null): boolean {
  if (!database) return false
  if (resolve(path) === database.path) return true
  try {
    const stat = statSync(path, { bigint: true })
    return stat.dev === database.device && stat.ino === database.inode
  } catch {
    return false
  }
}

/** Order known snapshot files oldest-first, using mtime for legacy local names. */
export function listSnapshots(dir: string, database: FileIdentity | null): string[] {
  const files = readdirSync(dir).filter(
    (file) => SNAPSHOT_RE.test(file) && !isProtectedDatabasePath(join(dir, file), database)
  )
  const stamp = (file: string) => {
    if (UTC_SNAPSHOT_RE.test(file)) return parseSnapshotTimestamp(file)
    try {
      return statSync(join(dir, file)).mtimeMs
    } catch {
      return parseSnapshotTimestamp(file)
    }
  }
  return files.sort((left, right) => stamp(left) - stamp(right) || left.localeCompare(right))
}

/** Remove excess old snapshots without treating a cleanup error as a failed backup. */
export function pruneSnapshots(input: {
  dir: string
  keep: number
  database: FileIdentity | null
  currentFile: string
  log: (message: string) => void
}): number {
  const { dir, keep, database, currentFile, log } = input
  let files: string[]
  try {
    files = listSnapshots(dir, database)
  } catch (error) {
    log(`backup retention skipped — cannot list ${dir}: ${String(error)}`)
    return 0
  }
  let pruned = 0
  for (const file of files
    .filter((name) => join(dir, name) !== currentFile)
    .slice(0, Math.max(0, files.length - keep))) {
    const path = join(dir, file)
    try {
      rmSync(path, { force: true })
      pruned++
    } catch (error) {
      log(`backup retention failed to remove ${path}: ${String(error)}`)
    }
  }
  return pruned
}
