import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { MigrationRunner } from '@adonisjs/lucid/migration'
import { sourceFiles } from '@adonisjs/lucid/utils'
import { parseManifest } from '#database/released_manifest'

const schemaTable = 'adonis_schema'
const schemaVersionsTable = 'adonis_schema_versions'

interface RecordedMigration {
  name: string
  batch: number
}

/** Check the exact executable set selected by Lucid against the current build's manifest. */
export async function assertReleasedMigrationFiles(
  manifest: Array<{ name: string; sha256: string }>,
  discovered: Array<{ name: string; absPath: string }>
) {
  const expected = manifest.map(({ name }) => name)
  const actual = discovered.map(({ name }) => name)
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('Migration files differ from the released manifest')
  for (const [index, { name, sha256 }] of manifest.entries()) {
    const digest = createHash('sha256')
      .update(await readFile(discovered[index]!.absPath))
      .digest('hex')
    if (digest !== sha256) throw new Error(`Released migration changed: ${name}`)
  }
}

/** Require the recorded sequence to be a prefix of the released migration sequence. */
export function assertMigrationJournal(
  recorded: RecordedMigration[],
  expected: string[],
  allowPending = false
) {
  let priorBatch = 0
  for (const [index, row] of recorded.entries()) {
    if (
      row.name !== expected[index] ||
      !Number.isInteger(row.batch) ||
      row.batch < 1 ||
      row.batch < priorBatch
    )
      throw new Error(`Migration journal is inconsistent at ${row.name}`)
    priorBatch = row.batch
  }
  if (!allowPending && recorded.length !== expected.length)
    throw new Error('Database has pending migrations')
}

/** Check source identity and the journal before serving requests or upgrading. */
export async function assertReleasedMigrations(options: { allowPending?: boolean } = {}) {
  const manifestPath = app.makePath('database/released.json')
  const manifest = parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  const connectionConfig = db.getRawConnection(db.primaryConnectionName)?.config
  if (!connectionConfig) throw new Error('Database connection is not configured')
  const migrationPaths = connectionConfig.migrations?.paths ?? ['database/migrations']
  if (migrationPaths.length !== 1 || migrationPaths[0] !== 'database/migrations')
    throw new Error('Released migration directory differs from configuration')
  const migrationSource = await sourceFiles(
    app.appRoot,
    migrationPaths[0],
    connectionConfig.migrations?.naturalSort ?? false
  )
  const discovered = migrationSource.files
  const runner = new MigrationRunner(db, app, { direction: 'up' })
  await assertReleasedMigrationFiles(manifest, discovered)
  const expected = manifest.map(({ name }) => name)

  const connection = db.connection()
  const hasJournal = await connection.schema.hasTable(schemaTable)
  const hasVersions = await connection.schema.hasTable(schemaVersionsTable)
  if (hasJournal !== hasVersions) throw new Error('Migration journal is incomplete')
  if (!hasJournal) {
    const existingTables = await connection
      .from('sqlite_master')
      .select('name')
      .where({ type: 'table' })
      .whereRaw("name NOT GLOB 'sqlite_*'")
    if (existingTables.length) throw new Error('Database schema has no migration journal')
    if (!options.allowPending) throw new Error('Database has pending migrations')
    return { pending: expected.length, recorded: 0 }
  }
  const versions = await connection.from(schemaVersionsTable).select('version')
  const journalVersion = Number(versions[0]?.version)
  if (
    versions.length !== 1 ||
    !Number.isInteger(journalVersion) ||
    journalVersion !== runner.version
  )
    throw new Error('Migration journal version is invalid')
  const recorded = (await connection
    .from(schemaTable)
    .select('name', 'batch')
    .orderBy('id', 'asc')) as RecordedMigration[]
  if (!recorded.length) {
    const existingTables = await connection
      .from('sqlite_master')
      .select('name')
      .where({ type: 'table' })
      .whereNotIn('name', [schemaTable, schemaVersionsTable])
      .whereRaw("name NOT GLOB 'sqlite_*'")
    if (existingTables.length) throw new Error('Database schema has unjournaled tables')
  }
  assertMigrationJournal(recorded, expected, options.allowPending)
  return { pending: expected.length - recorded.length, recorded: recorded.length }
}
