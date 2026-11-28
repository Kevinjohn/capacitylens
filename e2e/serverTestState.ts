import { expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { resolvePortLane, workerPorts } from '../tooling/ports.mjs'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, realpathSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { E2E_TAG_HEADER, E2E_TAG_PATH } from '../tooling/e2e_request_activity.ts'

const backendDirectory = fileURLToPath(new URL('../apps/backend/', import.meta.url))

/** All endpoints and files belonging to one stable browser-worker slot. */
export interface ServerTarget {
  portLane: number
  slot: number
  api: string
  databasePath: string
  templatePath: string
}

/** Resolve isolated browser-worker endpoints and disposable database paths. */
export function serverTarget(portLane: number, slot: number): ServerTarget {
  const endpoints = workerPorts(portLane, slot)
  const databasePath = resolve(backendDirectory, `.e2e-l${portLane}-w${slot}.db`)
  return Object.freeze({
    portLane,
    slot,
    api: `http://localhost:${endpoints.api}`,
    databasePath,
    templatePath: `${databasePath}.template`,
  })
}

let configuredTarget = serverTarget(resolvePortLane(), 0)
let currentTag: string | undefined
/** Current worker API origin; imports observe configuration before a test starts. */
export let API = configuredTarget.api

/** Bind this Playwright worker to its owned target. */
export function configureServerTarget(target: ServerTarget) {
  configuredTarget = target
  API = target.api
  currentTag = undefined
}

/** The headers every request of the current test sends, so the worker API accepts it. */
export function requireTestTagHeaders(): Record<string, string> {
  if (!currentTag) throw new Error('No database reset has issued a request tag yet.')
  return { [E2E_TAG_HEADER]: currentTag }
}

/**
 * Settles the worker API before a restore: the API makes `tag` current, refusing every request
 * that carries another, and answers once no handler is running. A new test passes a fresh tag; a
 * reset inside a test keeps the current one, so the test's own pages stay accepted.
 */
async function withRequestsSettled<T>(
  target: ServerTarget,
  tag: string,
  restore: () => T
): Promise<T> {
  if (target !== configuredTarget)
    throw new Error('A reset must use this worker’s configured target.')
  const response = await fetch(`${target.api}${E2E_TAG_PATH}?next=${encodeURIComponent(tag)}`, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok)
    throw new Error(
      `The worker API did not settle (HTTP ${response.status}): ${await response.text()}`
    )
  currentTag = tag
  return restore()
}

function assertDisposableDatabase(target: ServerTarget) {
  if (
    !/^\.e2e-l\d-w\d{1,2}\.db$/.test(basename(target.databasePath)) ||
    resolve(target.databasePath, '..') !== resolve(backendDirectory) ||
    !existsSync(target.databasePath) ||
    realpathSync(target.databasePath) !== resolve(target.databasePath)
  )
    throw new Error('The disposable database-backed fixture is unavailable.')
}

/** Verify the server bootstrapped its fixture identity; company resets never recreate credentials. */
export function ensureDbTestAdmin(target: ServerTarget = configuredTarget) {
  assertDisposableDatabase(target)
  const db = new DatabaseSync(target.databasePath, { readOnly: true })
  let found: boolean
  try {
    found = Boolean(db.prepare('SELECT id FROM users WHERE email = ?').get('admin@admin.admin'))
  } finally {
    db.close()
  }
  if (!found)
    throw new Error('The disposable administrator is unavailable; restart the worker fixture.')
}

const companyTables = [
  'companies',
  'clients',
  'disciplines',
  'projects',
  'phases',
  'resources',
  'activities',
  'allocations',
  'time_off',
  'closures',
  'memberships',
  'audit_entries',
  'company_planning_revisions',
  'planning_mutations',
  'deleted_batches',
  'deleted_rows',
  'account_member_resources',
  'company_settings',
  'company_getting_started_dismissals',
  'request_receipts',
  'password_confirmations',
] as const

function orderedCompanyTables(db: DatabaseSync): string[] {
  const remaining = new Set<string>(companyTables)
  const ordered: string[] = []
  while (remaining.size) {
    const next = [...remaining].find((table) => {
      const dependencies = db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as Array<{
        table: string
      }>
      return dependencies.every(
        (dependency) => dependency.table === table || !remaining.has(dependency.table)
      )
    })
    if (!next) throw new Error('Disposable company tables contain a foreign-key cycle.')
    const columns = db.prepare(`PRAGMA table_info("${next}")`).all()
    if (!columns.length) throw new Error(`The disposable schema is missing ${next}.`)
    ordered.push(next)
    remaining.delete(next)
  }
  return ordered
}

function bindFixtureOwner(db: DatabaseSync) {
  const administrator = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get('admin@admin.admin') as { id: string } | undefined
  if (!administrator) throw new Error('The disposable administrator is unavailable.')
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO memberships (scope_id, user_id, role, status, created_at, updated_at)
    VALUES ('a-studio', ?, 'owner', 'active', ?, ?)`
  ).run(administrator.id, now, now)
}

/** Snapshot the worker's initial company once; identities are never restored from this template. */
export async function prepareServerTemplate(target: ServerTarget): Promise<void> {
  await withRequestsSettled(target, randomUUID(), () => {
    ensureDbTestAdmin(target)
    const db = new DatabaseSync(target.databasePath)
    try {
      orderedCompanyTables(db)
      db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE')
      try {
        db.exec(
          "DELETE FROM audit_entries; DELETE FROM memberships; DELETE FROM companies WHERE id <> 'a-studio'"
        )
        bindFixtureOwner(db)
        db.exec(
          "INSERT OR IGNORE INTO company_planning_revisions (company_id, revision) VALUES ('a-studio', 0)"
        )
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      rmSync(target.templatePath, { force: true })
      db.prepare('VACUUM INTO ?').run(target.templatePath)
    } finally {
      db.close()
    }
  })
}

type ResetServerOptions = {
  withSeed?: boolean
  target?: ServerTarget
  /** Start a new test: issue a fresh request tag, so requests from the previous test are refused. */
  newTest?: boolean
}

/** Restore only company-owned tables through SQLite; users, sessions and Account Kit records survive. */
export async function resetServer({
  withSeed = true,
  target = configuredTarget,
  newTest = false,
}: ResetServerOptions): Promise<void> {
  const tag = newTest || !currentTag ? randomUUID() : currentTag
  await withRequestsSettled(target, tag, () => {
    ensureDbTestAdmin(target)
    if (
      !existsSync(target.templatePath) ||
      realpathSync(target.templatePath) !== resolve(target.templatePath)
    )
      throw new Error('The disposable company template is unavailable.')
    const db = new DatabaseSync(target.databasePath)
    try {
      db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000')
      const tables = orderedCompanyTables(db)
      db.prepare('ATTACH DATABASE ? AS fixture_template').run(target.templatePath)
      try {
        db.exec('BEGIN IMMEDIATE')
        try {
          for (const table of tables.toReversed()) db.exec(`DELETE FROM "${table}"`)
          if (withSeed) {
            for (const table of tables) {
              if (table === 'memberships') bindFixtureOwner(db)
              else db.exec(`INSERT INTO "${table}" SELECT * FROM fixture_template."${table}"`)
            }
          }
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      } finally {
        db.exec('DETACH DATABASE fixture_template')
      }
    } finally {
      db.close()
    }
  })
}

/** Read the real worker's company state for persistence assertions. */
export async function serverState(
  request: APIRequestContext,
  target: ServerTarget = configuredTarget
): Promise<
  Record<
    string,
    Array<{
      id: string
      name?: string
      archivedAt?: string
      language?: string
      seriesId?: string
      engagement?: 'studio' | 'supplementary'
      halfDays?: number[]
      avatarUrl?: string
    }>
  >
> {
  const response = await request.get(
    `${target.api}/api/v1/state?companyId=a-studio&includeInactive=1`,
    {
      maxRetries: 1,
    }
  )
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data
}
/** Returns the named table’s rows without changing the server state.
 * @throws Error when the response omits the table; callers must not treat an omitted table as empty.
 */
export function requireStateRows<T extends Awaited<ReturnType<typeof serverState>>>(
  state: T,
  table: keyof T
): T[keyof T] {
  const rows = state[table]
  if (rows === undefined) throw new Error(`Server state must include the ${String(table)} table`)
  return rows
}
