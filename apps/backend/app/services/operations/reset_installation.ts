import { closeSync, existsSync, lstatSync, mkdtempSync, openSync, renameSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import app from '@adonisjs/core/services/app'
import { operatorDatabasePath, withOperatorDatabase } from './operator_database.js'
import { assertReleasedMigrations } from '#services/released_migrations'
import { assertSchemaIntegrity } from '#services/schema_integrity'
import { durableSnapshotPublisher, writeOneShotSnapshot } from '#services/backup/snapshot'

function destinationEntryExists(path: string) {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Snapshot and archive a stopped installation, then create its replacement at a new path. */
export async function resetInstallation(input: {
  newDatabasePath: string
  confirmServerStopped: boolean
}) {
  const sourcePath = resolve(operatorDatabasePath(input.confirmServerStopped))
  const databasePath = resolve(input.newDatabasePath)
  if (
    sourcePath === databasePath ||
    [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, `${databasePath}-journal`].some(
      destinationEntryExists
    )
  )
    throw new Error('Reset destination or its sidecars already exist; choose a new database path')
  let archivePath: string | undefined
  let snapshotPath: string | undefined
  let destinationReserved = false
  let snapshotVerified = false
  let archived = false
  let stage = 'source validation'
  try {
    await withOperatorDatabase(async (connection) => {
      await assertReleasedMigrations()
      await assertSchemaIntegrity()
      // wx reserves the destination against concurrent operators; an unsuccessful reset leaves it visible.
      closeSync(openSync(databasePath, 'wx', 0o600))
      destinationReserved = true
      const archive = mkdtempSync(`${sourcePath}.reset-archive-`)
      archivePath = join(archive, 'original.db')
      snapshotPath = join(archive, 'snapshot.db')
      stage = 'verified snapshot'
      await writeOneShotSnapshot({
        database: connection,
        dir: archive,
        file: snapshotPath,
        overwrite: false,
      })
      stage = 'source checkpoint'
      snapshotVerified = true
      const checkpoint = connection.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>
      if (checkpoint.some((row) => row.busy !== 0))
        throw new Error('Reset could not checkpoint the source database')
      stage = 'source journal switch'
      const journal = connection.pragma('journal_mode = DELETE') as Array<{ journal_mode: string }>
      if (journal[0]?.journal_mode !== 'delete' || connection.inTransaction)
        throw new Error('Reset could not leave WAL mode')
      stage = 'source sidecar archive'
      for (const suffix of ['-wal', '-shm', '-journal']) {
        const sidecar = `${sourcePath}${suffix}`
        if (existsSync(sidecar)) {
          const retained = join(archive, `retained_source${suffix}`)
          renameSync(sidecar, retained)
          durableSnapshotPublisher.syncFile(retained)
        }
      }
      // The verified checkpoint and DELETE mode make the main archive complete on both supported hosts.
      stage = 'source archive'
      renameSync(sourcePath, archivePath)
      archived = true
      durableSnapshotPublisher.syncFile(archivePath)
      durableSnapshotPublisher.syncDirectory(archive)
      durableSnapshotPublisher.syncDirectory(dirname(sourcePath))
    })
    stage = 'new database upgrade'
    const migrated = spawnSync(process.execPath, ['ace.js', 'app:upgrade'], {
      cwd: app.appRoot,
      encoding: 'utf8',
      timeout: 60000,
      env: {
        ...process.env,
        CAPACITYLENS_DB: databasePath,
        CAPACITYLENS_BACKUP_DIR: '',
        CAPACITYLENS_CREATE_ADMIN_ADMIN: 'false',
        CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: '',
      },
    })
    if (migrated.error || migrated.status !== 0)
      throw new Error('New database upgrade failed', { cause: migrated.error })
    return { databasePath, archivePath, snapshotPath }
  } catch (cause) {
    if (!archivePath && !destinationReserved) throw cause
    const original = archived
      ? `Original archive: ${archivePath}`
      : `Original source remains at: ${sourcePath}`
    const snapshot = snapshotVerified
      ? `Verified snapshot: ${snapshotPath}`
      : 'No verified snapshot was completed'
    throw new Error(
      `Reset failed during ${stage}. ${original}; ${snapshot}; inspect partial destination: ${databasePath}. Do not retry over these files.`,
      { cause }
    )
  }
}
