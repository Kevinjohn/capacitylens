import { backup, DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import {
  DATABASE_MIGRATION_TABLE,
  DB_SCHEMA_VERSION,
  initializeOpenDb,
  openDb,
  openDbConnection,
  planDatabaseMigrations,
  type Db,
} from '../src/db'
import { writePreMigrationBackup } from '../src/backup'

const KNOWN_TABLES = new Set([
  '_meta',
  'accounts',
  'clients',
  'disciplines',
  'projects',
  'phases',
  'resources',
  'activities',
  'tasks',
  'allocations',
  'timeOff',
  'account_members',
  'invites',
  'user',
  'session',
  'account',
  'twoFactor',
  'verification',
  'capacitylens_bootstrap_claim',
  'account_security_revisions',
  'account_commands',
  'account_session_assurance',
  'account_federated_provider_bindings',
  DATABASE_MIGRATION_TABLE,
])

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`

const tableNames = (db: DatabaseSync): string[] =>
  (db.prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{
    name: string
  }>).map((row) => row.name)

const columns = (db: DatabaseSync, table: string): Set<string> =>
  new Set(
    (db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  )

const hasTable = (db: DatabaseSync, table: string): boolean => tableNames(db).includes(table)

function updateIfPresent(db: DatabaseSync, table: string, column: string, expression: string): void {
  if (!hasTable(db, table) || !columns(db, table).has(column)) return
  db.exec(`UPDATE ${quoteIdentifier(table)} SET ${quoteIdentifier(column)} = ${expression}`)
}

interface Reference {
  table: string
  column: string
}

/** Remap opaque ids as well as visible text. This preserves relationships while ensuring a
 * retained rehearsal directory cannot be joined back to ids from the source installation. */
function remapIds(db: DatabaseSync, table: string, idColumn: string, references: Reference[]): void {
  if (!hasTable(db, table) || !columns(db, table).has(idColumn)) return
  const values = db.prepare(
    `SELECT ${quoteIdentifier(idColumn)} AS id FROM ${quoteIdentifier(table)} ORDER BY ${quoteIdentifier(idColumn)}`,
  ).all() as Array<{ id: string | null }>
  const existing = new Set(values.flatMap((row) => row.id === null ? [] : [row.id]))
  const updatePrimary = db.prepare(
    `UPDATE ${quoteIdentifier(table)} SET ${quoteIdentifier(idColumn)} = ? WHERE ${quoteIdentifier(idColumn)} = ?`,
  )
  for (const [index, row] of values.entries()) {
    if (row.id === null) continue
    let replacement = `rehearsal-${table}-${index + 1}`
    while (existing.has(replacement)) replacement = `${replacement}-x`
    existing.add(replacement)
    updatePrimary.run(replacement, row.id)
    for (const reference of references) {
      if (!hasTable(db, reference.table) || !columns(db, reference.table).has(reference.column)) continue
      db.prepare(
        `UPDATE ${quoteIdentifier(reference.table)} SET ${quoteIdentifier(reference.column)} = ? ` +
          `WHERE ${quoteIdentifier(reference.column)} = ?`,
      ).run(replacement, row.id)
    }
  }
}

/** App-owned control tables intentionally have no foreign keys, so corrupted or legacy rows can
 * reference a principal/workspace that has no parent row for remapIds() to discover. Scrub those
 * residual opaque identifiers too: a kept rehearsal snapshot must not retain source-installation
 * identifiers merely because the live database could no longer resolve them. */
function scrubDanglingReferences(
  db: DatabaseSync,
  parentTable: string,
  parentColumn: string,
  references: Reference[],
  label: string,
): void {
  for (const reference of references) {
    if (!hasTable(db, reference.table) || !columns(db, reference.table).has(reference.column)) continue
    const table = quoteIdentifier(reference.table)
    const column = quoteIdentifier(reference.column)
    const replacement = `'rehearsal-dangling-${label}-' || rowid`
    if (!hasTable(db, parentTable) || !columns(db, parentTable).has(parentColumn)) {
      db.exec(`UPDATE ${table} SET ${column} = ${replacement} WHERE ${column} IS NOT NULL`)
      continue
    }
    db.exec(
      `UPDATE ${table} AS child
          SET ${column} = ${replacement}
        WHERE ${column} IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM ${quoteIdentifier(parentTable)} AS parent
             WHERE parent.${quoteIdentifier(parentColumn)} = child.${column}
          )`,
    )
  }
}

/** Sanitise only a temporary online snapshot. Unknown tables fail closed so a new auth/plugin table
 * cannot carry secrets into a kept rehearsal directory until the redaction policy covers it. */
function anonymise(db: DatabaseSync): void {
  const unknown = tableNames(db).filter((table) => !KNOWN_TABLES.has(table))
  if (unknown.length > 0) {
    throw new Error(`anonymiser does not cover table(s): ${unknown.join(', ')}`)
  }

  db.exec('PRAGMA foreign_keys = OFF; PRAGMA secure_delete = ON; BEGIN IMMEDIATE;')
  try {
    remapIds(db, 'accounts', 'id', [
      { table: 'clients', column: 'accountId' },
      { table: 'disciplines', column: 'accountId' },
      { table: 'projects', column: 'accountId' },
      { table: 'phases', column: 'accountId' },
      { table: 'resources', column: 'accountId' },
      { table: 'activities', column: 'accountId' },
      { table: 'tasks', column: 'accountId' },
      { table: 'allocations', column: 'accountId' },
      { table: 'timeOff', column: 'accountId' },
      { table: 'account_members', column: 'accountId' },
      { table: 'invites', column: 'accountId' },
      { table: 'account_commands', column: 'workspaceId' },
    ])
    remapIds(db, 'clients', 'id', [{ table: 'projects', column: 'clientId' }])
    remapIds(db, 'disciplines', 'id', [{ table: 'resources', column: 'disciplineId' }])
    remapIds(db, 'projects', 'id', [
      { table: 'phases', column: 'projectId' },
      { table: 'resources', column: 'projectId' },
      { table: 'activities', column: 'projectId' },
      { table: 'tasks', column: 'projectId' },
    ])
    remapIds(db, 'phases', 'id', [
      { table: 'activities', column: 'phaseId' },
      { table: 'tasks', column: 'phaseId' },
    ])
    remapIds(db, 'resources', 'id', [
      { table: 'allocations', column: 'resourceId' },
      { table: 'timeOff', column: 'resourceId' },
    ])
    remapIds(db, hasTable(db, 'activities') ? 'activities' : 'tasks', 'id', [
      { table: 'allocations', column: hasTable(db, 'activities') ? 'activityId' : 'taskId' },
    ])
    remapIds(db, 'allocations', 'id', [])
    remapIds(db, 'timeOff', 'id', [])
    remapIds(db, 'user', 'id', [
      { table: 'account', column: 'userId' },
      { table: 'session', column: 'userId' },
      { table: 'twoFactor', column: 'userId' },
      { table: 'account_members', column: 'userId' },
      { table: 'account_security_revisions', column: 'principalId' },
      { table: 'account_commands', column: 'actorPrincipalId' },
      { table: 'account_commands', column: 'targetPrincipalId' },
      { table: 'account_session_assurance', column: 'principalId' },
    ])
    remapIds(db, 'account', 'id', [])
    // Assurance keys are application-scoped hashes of bearer session tokens, not Better Auth row
    // ids, so anonymise the two namespaces independently.
    remapIds(db, 'session', 'id', [])
    remapIds(db, 'twoFactor', 'id', [])
    remapIds(db, 'verification', 'id', [])
    remapIds(db, 'invites', 'id', [])
    remapIds(db, 'account_commands', 'commandId', [])
    remapIds(db, 'account_session_assurance', 'sessionId', [])
    remapIds(db, 'account_federated_provider_bindings', 'providerId', [
      { table: 'account', column: 'providerId' },
      { table: 'account_session_assurance', column: 'providerId' },
    ])
    scrubDanglingReferences(db, 'accounts', 'id', [
      { table: 'account_members', column: 'accountId' },
      { table: 'invites', column: 'accountId' },
      { table: 'account_commands', column: 'workspaceId' },
    ], 'workspace')
    scrubDanglingReferences(db, 'user', 'id', [
      { table: 'account_members', column: 'userId' },
      { table: 'account_security_revisions', column: 'principalId' },
      { table: 'account_commands', column: 'actorPrincipalId' },
      { table: 'account_commands', column: 'targetPrincipalId' },
      { table: 'account_session_assurance', column: 'principalId' },
    ], 'principal')
    // Credential rows and stale/legacy federated rows do not necessarily have a corresponding
    // application binding. Their providerId still identifies the source installation, so scrub
    // every value that the binding remap above could not resolve.
    scrubDanglingReferences(db, 'account_federated_provider_bindings', 'providerId', [
      { table: 'account', column: 'providerId' },
      { table: 'account_session_assurance', column: 'providerId' },
    ], 'provider')

    updateIfPresent(db, 'accounts', 'name', `'Rehearsal Account ' || rowid`)
    updateIfPresent(
      db,
      'clients',
      'name',
      columns(db, 'clients').has('builtin')
        ? `CASE WHEN builtin = 'true' THEN 'Internal' ELSE 'Rehearsal Client ' || rowid END`
        : `'Rehearsal Client ' || rowid`,
    )
    updateIfPresent(db, 'clients', 'codeName', `CASE WHEN codeName IS NULL THEN NULL ELSE 'Client ' || rowid END`)
    updateIfPresent(db, 'disciplines', 'name', `'Rehearsal Discipline ' || rowid`)
    updateIfPresent(db, 'projects', 'name', `'Rehearsal Project ' || rowid`)
    updateIfPresent(db, 'projects', 'codeName', `CASE WHEN codeName IS NULL THEN NULL ELSE 'Project ' || rowid END`)
    updateIfPresent(db, 'phases', 'name', `'Rehearsal Phase ' || rowid`)
    updateIfPresent(db, 'resources', 'name', `CASE WHEN name IS NULL THEN NULL ELSE 'Rehearsal Resource ' || rowid END`)
    updateIfPresent(db, 'resources', 'role', `'Rehearsal Role ' || rowid`)
    updateIfPresent(db, hasTable(db, 'activities') ? 'activities' : 'tasks', 'name', `'Rehearsal Activity ' || rowid`)
    updateIfPresent(db, 'allocations', 'note', 'NULL')
    updateIfPresent(db, 'timeOff', 'note', 'NULL')

    updateIfPresent(db, 'user', 'name', `'Rehearsal User ' || rowid`)
    updateIfPresent(db, 'user', 'email', `'rehearsal-user-' || rowid || '@example.invalid'`)
    updateIfPresent(db, 'user', 'image', 'NULL')
    updateIfPresent(db, 'account', 'accountId', `'rehearsal-provider-account-' || rowid`)
    for (const secret of ['accessToken', 'refreshToken', 'idToken', 'password']) {
      updateIfPresent(db, 'account', secret, 'NULL')
    }
    updateIfPresent(db, 'session', 'token', `'rehearsal-session-' || rowid`)
    updateIfPresent(db, 'session', 'ipAddress', 'NULL')
    updateIfPresent(db, 'session', 'userAgent', `'Rehearsal'`)
    updateIfPresent(db, 'twoFactor', 'secret', `'rehearsal-disabled-' || rowid`)
    updateIfPresent(db, 'twoFactor', 'backupCodes', `'[]'`)
    updateIfPresent(db, 'verification', 'identifier', `'rehearsal-verification-' || rowid`)
    updateIfPresent(db, 'verification', 'value', `'rehearsal-disabled-' || rowid`)
    updateIfPresent(db, 'invites', 'token', `'rehearsal-invite-' || rowid`)
    updateIfPresent(db, 'invites', 'tokenHash', `'rehearsal-invite-hash-' || rowid`)
    updateIfPresent(db, 'invites', 'preauthEmail', `CASE WHEN preauthEmail IS NULL THEN NULL ELSE 'invite-' || rowid || '@example.invalid' END`)
    updateIfPresent(db, 'capacitylens_bootstrap_claim', 'claimToken', `'rehearsal-disabled'`)
    updateIfPresent(db, 'account_commands', 'applicationId', `'rehearsal-app'`)
    updateIfPresent(db, 'account_commands', 'operation', `'rehearsal-operation-' || rowid`)
    updateIfPresent(db, 'account_commands', 'idempotencyKey', `'rehearsal-key-' || rowid`)
    updateIfPresent(db, 'account_commands', 'payloadHash', `lower(hex(zeroblob(32)))`)
    updateIfPresent(
      db,
      'account_commands',
      'resultJson',
      `CASE
         WHEN status = 'pending' THEN NULL
         WHEN status = 'completed' THEN '{}'
         WHEN resultJson IS NULL THEN NULL
         ELSE '{"kind":"rehearsal-redacted"}'
       END`,
    )
    updateIfPresent(db, 'account_federated_provider_bindings', 'applicationId', `'rehearsal-app'`)
    updateIfPresent(
      db,
      'account_federated_provider_bindings',
      'issuer',
      `'https://idp-' || rowid || '.example.invalid'`,
    )
    db.exec('COMMIT;')
  } catch (error) {
    db.exec('ROLLBACK;')
    throw error
  }

  const violations = db.prepare('PRAGMA foreign_key_check').all()
  if (violations.length > 0) throw new Error(`anonymised copy has ${violations.length} foreign-key violation(s)`)
  // Rewrite every page so deleted/replaced source values are not left in freelist pages.
  db.exec('VACUUM; PRAGMA journal_mode = DELETE;')
}

function rowCounts(db: DatabaseSync): Record<string, number> {
  return Object.fromEntries(
    tableNames(db).map((table) => [
      table,
      Number((db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdentifier(table)}`).get() as { n: number }).n),
    ]),
  )
}

function serialisable(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64')
  if (Array.isArray(value)) return value.map(serialisable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0).map(
        ([key, item]) => [key, serialisable(item)],
      ),
    )
  }
  return value
}

/** Digest schema, rows and version stamps so rollback scenarios detect more than row-count drift. */
function databaseDigest(db: DatabaseSync): string {
  const hash = createHash('sha256')
  const version = db.prepare('PRAGMA user_version').get()
  const applicationId = db.prepare('PRAGMA application_id').get()
  hash.update(JSON.stringify(serialisable({ version, applicationId })))
  const schemas = db.prepare(
    `SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
  ).all()
  hash.update(JSON.stringify(serialisable(schemas)))
  for (const table of tableNames(db)) {
    const rows = db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all()
      .map((row) => JSON.stringify(serialisable(row)))
      .sort()
    hash.update(table)
    hash.update(JSON.stringify(rows))
  }
  return hash.digest('hex')
}

function checkIntegrity(db: DatabaseSync, label: string): void {
  const quick = db.prepare('PRAGMA quick_check').all() as Array<{ quick_check?: string }>
  if (quick.length !== 1 || quick[0]?.quick_check !== 'ok') throw new Error(`${label}: quick_check failed`)
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all()
  if (foreignKeys.length > 0) throw new Error(`${label}: ${foreignKeys.length} foreign-key violation(s)`)
}

function assertPreserved(before: Record<string, number>, after: Record<string, number>): void {
  for (const [table, count] of Object.entries(before)) {
    if (table === 'clients' || table === '_meta' || table === DATABASE_MIGRATION_TABLE) continue
    const target = table === 'tasks' ? 'activities' : table
    if (after[target] !== count) {
      throw new Error(`happy path changed ${table} row count from ${count} to ${after[target] ?? 0}`)
    }
  }
  if ((after.clients ?? 0) < (after.accounts ?? 0)) {
    throw new Error('happy path did not leave every account with an Internal client')
  }
}

async function onlineCopy(sourcePath: string, destinationPath: string): Promise<void> {
  const source = new DatabaseSync(sourcePath, { readOnly: true, enableForeignKeyConstraints: false })
  try {
    await backup(source, destinationPath)
  } finally {
    source.close()
  }
}

async function expectKilledMigrationRollsBack(path: string, expectedDigest: string): Promise<void> {
  const script = fileURLToPath(import.meta.url)
  const child = spawn(process.execPath, [...process.execArgv, script, '--worker-kill', path], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`kill rehearsal worker timed out${stderr ? `: ${stderr}` : ''}`))
    }, 15_000)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (stdout.includes('CAPACITYLENS_MIGRATION_READY')) child.kill('SIGKILL')
    })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolvePromise({ code, signal })
    })
  })
  if (outcome.signal !== 'SIGKILL') {
    throw new Error(`kill rehearsal worker exited unexpectedly (${outcome.code ?? outcome.signal}): ${stderr}`)
  }
  const recovered = new DatabaseSync(path, { enableForeignKeyConstraints: false })
  try {
    checkIntegrity(recovered, 'process-termination recovery')
    if (databaseDigest(recovered) !== expectedDigest) {
      throw new Error('process termination left a partially applied migration')
    }
  } finally {
    recovered.close()
  }
}

async function workerKill(path: string): Promise<never> {
  const db = openDbConnection(path)
  initializeOpenDb(db, path, {
    beforeCommit: () => {
      writeSync(1, 'CAPACITYLENS_MIGRATION_READY\n')
      // Parent sends SIGKILL while the real migration transaction is still open.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
    },
  })
  throw new Error('kill rehearsal worker unexpectedly committed')
}

interface CliOptions {
  source: string
  keep: boolean
}

function parseOptions(args: string[]): CliOptions {
  let source: string | undefined
  let keep = false
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--') continue
    if (args[index] === '--source') {
      source = args[++index]
      if (!source) throw new Error('--source requires a database path')
    }
    else if (args[index] === '--keep') keep = true
    else throw new Error(`unknown argument ${JSON.stringify(args[index])}`)
  }
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd()
  return {
    source: source
      ? resolve(invocationDirectory, source)
      : resolve(fileURLToPath(new URL('../src/fixtures/databases/v7-password.db', import.meta.url))),
    keep,
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  if (!existsSync(options.source)) throw new Error(`source database does not exist: ${options.source}`)
  const directory = mkdtempSync(join(tmpdir(), 'capacitylens-migration-rehearsal-'))
  try {
    const base = join(directory, 'anonymised-source.db')
    await onlineCopy(options.source, base)
    const sanitising = new DatabaseSync(base, { enableForeignKeyConstraints: false })
    anonymise(sanitising)
    checkIntegrity(sanitising, 'anonymised source')
    const beforeVersion = Number(
      (sanitising.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    )
    const beforeCounts = rowCounts(sanitising)
    const beforeDigest = databaseDigest(sanitising)
    const plan = planDatabaseMigrations(sanitising as Db)
    sanitising.close()
    if (plan.migrations.length === 0) {
      throw new Error(`source is already at database v${DB_SCHEMA_VERSION}; choose an older released database`)
    }

    const happyPath = join(directory, 'happy.db')
    copyFileSync(base, happyPath)
    const backups = join(directory, 'backups')
    mkdirSync(backups)
    const happy = openDbConnection(happyPath)
    const rollback = await writePreMigrationBackup(happy, {
      dbPath: happyPath,
      fromVersion: plan.fromVersion,
      toVersion: plan.toVersion,
      dir: backups,
    }, () => {})
    initializeOpenDb(happy, happyPath)
    checkIntegrity(happy, 'happy path')
    assertPreserved(beforeCounts, rowCounts(happy))
    happy.close()
    if (!rollback) throw new Error('happy path did not create a rollback snapshot')

    const rollbackDb = new DatabaseSync(rollback, { readOnly: true, enableForeignKeyConstraints: false })
    checkIntegrity(rollbackDb, 'rollback snapshot')
    if (databaseDigest(rollbackDb) !== beforeDigest) throw new Error('rollback snapshot differs from anonymised source')
    rollbackDb.close()

    const reopened = openDb(happyPath)
    if (planDatabaseMigrations(reopened).migrations.length !== 0) throw new Error('reopen was not idempotent')
    reopened.close()

    const diskFullPath = join(directory, 'disk-full.db')
    copyFileSync(base, diskFullPath)
    const diskFull = openDbConnection(diskFullPath)
    const diskError = Object.assign(new Error('simulated ENOSPC during migration'), { code: 'ENOSPC' })
    let failedAsExpected = false
    try {
      initializeOpenDb(diskFull, diskFullPath, { beforeCommit: () => { throw diskError } })
    } catch (error) {
      if (error === diskError) failedAsExpected = true
      else throw error
    }
    if (!failedAsExpected) throw new Error('simulated disk exhaustion unexpectedly committed')
    checkIntegrity(diskFull, 'disk-exhaustion rollback')
    if (databaseDigest(diskFull) !== beforeDigest) throw new Error('disk exhaustion left a partially applied migration')
    diskFull.close()

    const killedPath = join(directory, 'killed.db')
    copyFileSync(base, killedPath)
    await expectKilledMigrationRollsBack(killedPath, beforeDigest)

    const totalRows = Object.values(beforeCounts).reduce((sum, count) => sum + count, 0)
    console.log(
      `Migration rehearsal passed: ${basename(options.source)} v${beforeVersion} → v${DB_SCHEMA_VERSION}; ` +
        `${Object.keys(beforeCounts).length} tables / ${totalRows} rows; happy path, verified rollback snapshot, ` +
        `simulated ENOSPC rollback, forced-termination recovery, and idempotent reopen all passed.`,
    )
    if (options.keep) console.log(`Anonymised rehearsal artifacts retained at ${directory}`)
  } finally {
    if (!options.keep) rmSync(directory, { recursive: true, force: true })
  }
}

if (process.argv[2] === '--worker-kill') {
  await workerKill(resolve(process.argv[3]))
} else {
  await main()
}
