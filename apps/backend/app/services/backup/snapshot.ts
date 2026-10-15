import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  linkSync,
  unlinkSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { openNativeDatabase, type NativeDatabase } from './native.js'
import { isProtectedDatabasePath, readMainDatabaseIdentity } from './retention.js'

/** Filesystem durability operations for verified snapshot publication. */
export interface SnapshotPublisher {
  chmod(path: string, mode: number): void
  syncFile(path: string): void
  rename(from: string, to: string): void
  syncDirectory(path: string): void
}

function syncPath(path: string) {
  const descriptor = openSync(path, 'r')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

/** Native filesystem implementation of snapshot durability barriers. */
export const durableSnapshotPublisher: SnapshotPublisher = {
  chmod: chmodSync,
  syncFile: syncPath,
  rename: renameSync,
  syncDirectory: syncPath,
}

/** Create or tighten a backup destination to owner-only access. */
export function ensurePrivateBackupDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  chmodSync(path, 0o700)
}

/** Remove unpublished temporary artifacts after a failed copy. */
export function cleanupSnapshotTemp(path: string, log: (message: string) => void): void {
  for (const artifact of [path, `${path}-wal`, `${path}-shm`]) {
    try {
      rmSync(artifact, { force: true })
    } catch (error) {
      log(`backup temp cleanup failed for ${artifact}: ${String(error)}`)
    }
  }
}

function schemaRows(database: NativeDatabase): unknown[] {
  const exists = database
    .prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'adonis_schema'"
    )
    .get()
  return exists ? database.prepare('SELECT * FROM adonis_schema ORDER BY id').all() : []
}

function verifySnapshot(path: string, expectedSchema: unknown[], label: string): void {
  const copied = openNativeDatabase(path, { fileMustExist: true })
  try {
    const quick = copied.pragma('quick_check') as Array<{ quick_check: string }>
    if (quick.length !== 1 || quick[0]?.quick_check !== 'ok')
      throw new Error(`${label} failed SQLite quick_check`)
    const violations = copied.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0)
      throw new Error(
        `${label} failed SQLite foreign_key_check (${violations.length} violation(s))`
      )
    if (JSON.stringify(schemaRows(copied)) !== JSON.stringify(expectedSchema))
      throw new Error(`${label} adonis_schema mismatch`)
    copied.pragma('wal_checkpoint(TRUNCATE)')
    copied.pragma('journal_mode = DELETE')
  } finally {
    copied.close()
  }
}

/** Reserve, copy online, verify and durably publish one SQLite snapshot. */
export async function writeOneShotSnapshot(input: {
  database: NativeDatabase
  dir: string
  file: string
  label?: string
  log?: (message: string) => void
  publisher?: SnapshotPublisher
  overwrite?: boolean
}): Promise<string> {
  const {
    database,
    dir,
    file,
    label = 'snapshot',
    log = () => {},
    publisher = durableSnapshotPublisher,
    overwrite = true,
  } = input
  if (resolve(dirname(file)) !== resolve(dir))
    throw new Error('Snapshot file must be inside the configured directory')
  if (isProtectedDatabasePath(file, readMainDatabaseIdentity(database)))
    throw new Error('Snapshot destination is the live SQLite database')
  const expectedSchema = schemaRows(database)
  let tmp: string | undefined
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = `${file}.${process.pid}-${attempt}.tmp`
      try {
        writeFileSync(candidate, '', { flag: 'wx', mode: 0o600 })
        tmp = candidate
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    if (!tmp) throw new Error('Could not reserve a unique snapshot temporary file')
    await database.backup(tmp)
    verifySnapshot(tmp, expectedSchema, label)
    rmSync(`${tmp}-wal`, { force: true })
    rmSync(`${tmp}-shm`, { force: true })
    publisher.chmod(tmp, 0o600)
    publisher.syncFile(tmp)
    if (overwrite) publisher.rename(tmp, file)
    else {
      linkSync(tmp, file)
      unlinkSync(tmp)
    }
    publisher.syncDirectory(dir)
    return file
  } catch (error) {
    if (tmp) cleanupSnapshotTemp(tmp, log)
    throw error
  }
}
