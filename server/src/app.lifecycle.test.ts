import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'
import { openDb, insertAll, type Db } from './db'
import { upsertMember } from './controlTables'
import { authFromEnv, runAuthMigrations } from './auth'
import { fileAuditSink, type AuditRecord } from './audit'
import { PASSWORD_ENV, call, signUp } from './testHelpers'
import { buildInternalClient } from '@capacitylens/shared/data/internalClient'
import { emptyAppData, type AppData } from '@capacitylens/shared/types/entities'

// P2.5a entity-lifecycle routes — the SERVER half of the Active→Archived→Soft-deleted→Purged machine.
// This suite drives the four dedicated action routes (archive/unarchive/delete/purge) + the
// `?includeInactive=1` admin read END-TO-END (sign-up → membership → request) and asserts the resulting
// status codes, the server-enforced interlocks (409s), the purge cascade, the persisted resource
// obfuscation (P2.3 carry-forward) and the built-in-Internal-client guard. The pure transitions
// themselves are unit-tested in shared/domain/lifecycle.test.ts; here we prove the WIRING:
// authorize tiers, findOwned tenancy, replaceAccountSlice round-trip and the audit line.

const TS = '2026-01-01T00:00:00.000Z'
const meta = () => ({ createdAt: TS, updatedAt: TS })

const account = (id: string) => ({ id, name: `Studio ${id}`, color: '#3b82f6', ...meta() })
const client = (id: string, accountId: string, extra: Record<string, unknown> = {}) => ({
  id,
  accountId,
  name: 'Acme',
  color: '#3b82f6',
  ...meta(),
  ...extra,
})
const project = (id: string, accountId: string, clientId: string, extra: Record<string, unknown> = {}) => ({
  id,
  accountId,
  name: 'Web',
  clientId,
  color: '#3b82f6',
  ...meta(),
  ...extra,
})
const person = (id: string, accountId: string, extra: Record<string, unknown> = {}) => ({
  id,
  accountId,
  kind: 'person',
  name: 'Pat Designer',
  role: 'Designer',
  employmentType: 'permanent',
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  color: '#3b82f6',
  ...meta(),
  ...extra,
})
const phase = (id: string, accountId: string, projectId: string) => ({
  id,
  accountId,
  name: 'Phase 1',
  projectId,
  ...meta(),
})
const activity = (id: string, accountId: string, projectId: string, phaseId: string) => ({
  id,
  accountId,
  name: 'Build',
  kind: 'project',
  projectId,
  phaseId,
  ...meta(),
})
const allocation = (id: string, accountId: string, resourceId: string, activityId: string) => ({
  id,
  accountId,
  resourceId,
  activityId,
  startDate: '2026-02-01',
  endDate: '2026-02-05',
  hoursPerDay: 6,
  status: 'confirmed',
  ...meta(),
})

// A 31-day-old soft-delete tombstone: aged just past PURGE_MIN_AGE_DAYS (30) so canPurge passes. The
// archivedAt precedes it (soft-delete requires prior archival), but deletedAt WINS for the state read.
const THIRTY_ONE_DAYS_AGO = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
const archivedTombstone = { archivedAt: TS, deletedAt: THIRTY_ONE_DAYS_AGO }
const justArchived = { archivedAt: TS }

/** Build an auth-on (password) app over a fresh in-memory DB, returning both so the test can seed. */
async function appWithAuth(): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(':memory:')
  const { mode, auth } = authFromEnv(db, PASSWORD_ENV)
  await runAuthMigrations(auth!)
  return { app: buildApp(db, { authMode: mode, auth }), db }
}

// ---- Lifecycle action requests (cookie carries the session in auth-on; omit it for OFF). ----

const lifecycleAction = (
  app: FastifyInstance,
  entity: string,
  id: string,
  action: 'archive' | 'unarchive' | 'delete' | 'purge',
  accountId: string,
  cookie?: string,
) =>
  call(app, {
    method: 'POST',
    url: `/api/${entity}/${id}/${action}`,
    payload: { accountId },
    headers: cookie ? { cookie } : {},
  })

const readInactive = (app: FastifyInstance, accountId: string, cookie?: string) =>
  call(app, {
    method: 'GET',
    url: `/api/state?accountId=${accountId}&includeInactive=1`,
    headers: cookie ? { cookie } : {},
  })

// One built-in Internal client whose id is captured so the built-in-guard test can target it (its id is
// random per buildInternalClient call, so it MUST be built once and reused — not rebuilt at assert time).
const INTERNAL = buildInternalClient('a1', TS)

/**
 * Seed one account a1 with a client/project/resource in each of the states a test needs:
 *  - c1/p1/r1: ACTIVE  (archive/delete-interlock subjects)
 *  - cArc/pArc/rArc: ARCHIVED (unarchive/delete subjects)
 *  - rDel: a soft-delete TOMBSTONE aged 31 days (purge-eligible)
 *  - rYoung: a soft-delete tombstone aged 0 days (purge-too-young → 409)
 *  - INTERNAL: the built-in Internal client (builtin:true)
 * a2 carries c2 so cross-tenant tests have a foreign target.
 */
function seedStates(db: Db): void {
  const d = emptyAppData() as unknown as Record<string, unknown[]>
  d.accounts = [account('a1'), account('a2')]
  d.clients = [client('c1', 'a1'), client('cArc', 'a1', justArchived), INTERNAL, client('c2', 'a2')]
  d.projects = [project('p1', 'a1', 'c1'), project('pArc', 'a1', 'c1', justArchived)]
  d.resources = [
    person('r1', 'a1'),
    person('rArc', 'a1', justArchived),
    person('rDel', 'a1', archivedTombstone),
    person('rYoung', 'a1', { archivedAt: TS, deletedAt: new Date().toISOString() }),
  ]
  insertAll(db, d as unknown as AppData)
}

describe('P2.5a lifecycle — auth-on 403 permission matrix', () => {
  it('viewer of a1: archive/unarchive/delete/purge AND read-inactive → 403', async () => {
    const { app, db } = await appWithAuth()
    seedStates(db)
    const { cookie, userId } = await signUp(app, 'viewer-lc@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'viewer', status: 'active', createdAt: TS })

    expect((await lifecycleAction(app, 'clients', 'c1', 'archive', 'a1', cookie)).statusCode).toBe(403)
    expect((await lifecycleAction(app, 'clients', 'cArc', 'unarchive', 'a1', cookie)).statusCode).toBe(403)
    expect((await lifecycleAction(app, 'resources', 'rArc', 'delete', 'a1', cookie)).statusCode).toBe(403)
    expect((await lifecycleAction(app, 'resources', 'rDel', 'purge', 'a1', cookie)).statusCode).toBe(403)
    expect((await readInactive(app, 'a1', cookie)).statusCode).toBe(403)
  })

  it('editor of a1: archive/unarchive/delete → 2xx; purge → 403; read-inactive → 403', async () => {
    const { app, db } = await appWithAuth()
    seedStates(db)
    const { cookie, userId } = await signUp(app, 'editor-lc@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'editor', status: 'active', createdAt: TS })

    expect((await lifecycleAction(app, 'clients', 'c1', 'archive', 'a1', cookie)).statusCode).toBe(200)
    expect((await lifecycleAction(app, 'clients', 'cArc', 'unarchive', 'a1', cookie)).statusCode).toBe(200)
    expect((await lifecycleAction(app, 'resources', 'rArc', 'delete', 'a1', cookie)).statusCode).toBe(200)
    // purge is admin+ → editor refused even though rDel IS purge-eligible (403 before the interlock).
    expect((await lifecycleAction(app, 'resources', 'rDel', 'purge', 'a1', cookie)).statusCode).toBe(403)
    expect((await readInactive(app, 'a1', cookie)).statusCode).toBe(403)
  })

  it.each(['admin', 'owner'] as const)('%s of a1: every lifecycle route + read-inactive → 2xx', async (role) => {
    const { app, db } = await appWithAuth()
    seedStates(db)
    const { cookie, userId } = await signUp(app, `${role}-lc@capacitylens.dev`)
    upsertMember(db, { accountId: 'a1', userId, role, status: 'active', createdAt: TS })

    expect((await lifecycleAction(app, 'projects', 'p1', 'archive', 'a1', cookie)).statusCode).toBe(200)
    expect((await lifecycleAction(app, 'projects', 'pArc', 'unarchive', 'a1', cookie)).statusCode).toBe(200)
    expect((await lifecycleAction(app, 'resources', 'rArc', 'delete', 'a1', cookie)).statusCode).toBe(200)
    expect((await lifecycleAction(app, 'resources', 'rDel', 'purge', 'a1', cookie)).statusCode).toBe(204)
    expect((await readInactive(app, 'a1', cookie)).statusCode).toBe(200)
  })

  it('non-member (signed in, no membership): every lifecycle route + read-inactive → 403', async () => {
    const { app, db } = await appWithAuth()
    seedStates(db)
    const { cookie } = await signUp(app, 'stranger-lc@capacitylens.dev') // NO membership

    expect((await lifecycleAction(app, 'clients', 'c1', 'archive', 'a1', cookie)).statusCode).toBe(403)
    expect((await lifecycleAction(app, 'clients', 'cArc', 'unarchive', 'a1', cookie)).statusCode).toBe(403)
    expect((await lifecycleAction(app, 'resources', 'rArc', 'delete', 'a1', cookie)).statusCode).toBe(403)
    expect((await lifecycleAction(app, 'resources', 'rDel', 'purge', 'a1', cookie)).statusCode).toBe(403)
    expect((await readInactive(app, 'a1', cookie)).statusCode).toBe(403)
  })
})

describe('P2.5a lifecycle — interlock 409s (illegal transitions / preconditions)', () => {
  it('delete on an ACTIVE row → 409 (must be archived first)', async () => {
    const { app, db } = await appWithAuth()
    seedStates(db)
    const { cookie, userId } = await signUp(app, 'il-delete-active@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'editor', status: 'active', createdAt: TS })

    const res = await lifecycleAction(app, 'resources', 'r1', 'delete', 'a1', cookie)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/must be archived first/)
  })

  it('archive on an already-archived row → 409', async () => {
    const { app, db } = await appWithAuth()
    seedStates(db)
    const { cookie, userId } = await signUp(app, 'il-arc-arc@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'editor', status: 'active', createdAt: TS })

    const res = await lifecycleAction(app, 'clients', 'cArc', 'archive', 'a1', cookie)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/already archived/)
  })

  it('unarchive on an ACTIVE row → 409 (nothing to undo)', async () => {
    const { app, db } = await appWithAuth()
    seedStates(db)
    const { cookie, userId } = await signUp(app, 'il-unarc-active@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'editor', status: 'active', createdAt: TS })

    const res = await lifecycleAction(app, 'clients', 'c1', 'unarchive', 'a1', cookie)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/not archived/)
  })

  it('purge on a tombstone aged < 30 days → 409', async () => {
    const { app, db } = await appWithAuth()
    seedStates(db)
    const { cookie, userId } = await signUp(app, 'il-purge-young@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'admin', status: 'active', createdAt: TS })

    const res = await lifecycleAction(app, 'resources', 'rYoung', 'purge', 'a1', cookie)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/at least 30 days old/)
  })

  it('purge on a NON-tombstone (archived) row → 409', async () => {
    const { app, db } = await appWithAuth()
    seedStates(db)
    const { cookie, userId } = await signUp(app, 'il-purge-archived@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'admin', status: 'active', createdAt: TS })

    const res = await lifecycleAction(app, 'resources', 'rArc', 'purge', 'a1', cookie)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/soft-deleted tombstone/)
  })

  it('unarchive on a soft-deleted tombstone → 409 (a tombstone must not resurrect to active)', async () => {
    const { app, db } = await appWithAuth()
    seedStates(db)
    const { cookie, userId } = await signUp(app, 'il-unarc-tombstone@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'editor', status: 'active', createdAt: TS })

    // rDel is a soft-delete tombstone (deletedAt set). canUnarchive gates 'archived' ONLY, so clearing
    // archivedAt here would leave the tombstone still 'deleted' — the transition refuses outright.
    const res = await lifecycleAction(app, 'resources', 'rDel', 'unarchive', 'a1', cookie)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/not archived/)
  })

  it('delete on a soft-deleted tombstone → 409 (no re-delete; softDelete requires archived)', async () => {
    const { app, db } = await appWithAuth()
    seedStates(db)
    const { cookie, userId } = await signUp(app, 'il-redelete-tombstone@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'editor', status: 'active', createdAt: TS })

    // rDel already reads 'deleted'; softDelete requires 'archived', so a re-delete is a 409, not a no-op.
    const res = await lifecycleAction(app, 'resources', 'rDel', 'delete', 'a1', cookie)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/must be archived first/)
  })

  it('unknown lifecycle entity → 404; missing accountId → 400; missing row → 404', async () => {
    const { app, db } = await appWithAuth()
    seedStates(db)
    const { cookie, userId } = await signUp(app, 'il-shape@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'admin', status: 'active', createdAt: TS })

    // 'phases' is scoped but carries NO lifecycle tombstone → 404 on a lifecycle route.
    expect((await lifecycleAction(app, 'phases', 'x', 'archive', 'a1', cookie)).statusCode).toBe(404)
    // missing accountId in the body → 400.
    const noAcct = await call(app, { method: 'POST', url: '/api/clients/c1/archive', payload: {}, headers: { cookie } })
    expect(noAcct.statusCode).toBe(400)
    // a row that isn't there → 404 (after authorize passes).
    expect((await lifecycleAction(app, 'clients', 'nope', 'archive', 'a1', cookie)).statusCode).toBe(404)
  })
})

describe('P2.5a lifecycle — purge cascade removes the row + its descendants', () => {
  it('purging a tombstoned client removes its projects/phases/activities/allocations', async () => {
    const { app, db } = await appWithAuth()
    // Seed a client with a full subtree (project → phase → activity → allocation) AND an aged tombstone
    // on the client, so it is purge-eligible without going through archive→delete here.
    const d = emptyAppData() as unknown as Record<string, unknown[]>
    d.accounts = [account('a1')]
    d.clients = [client('cTree', 'a1', archivedTombstone)]
    d.projects = [project('pTree', 'a1', 'cTree')]
    d.phases = [phase('phTree', 'a1', 'pTree')]
    d.activities = [activity('actTree', 'a1', 'pTree', 'phTree')]
    d.resources = [person('rTree', 'a1')]
    d.allocations = [allocation('alTree', 'a1', 'rTree', 'actTree')]
    insertAll(db, d as unknown as AppData)

    const { cookie, userId } = await signUp(app, 'cascade@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'admin', status: 'active', createdAt: TS })

    expect((await lifecycleAction(app, 'clients', 'cTree', 'purge', 'a1', cookie)).statusCode).toBe(204)

    // Read the FULL (admin) slice and confirm the client AND its whole subtree are GONE.
    const after = await readInactive(app, 'a1', cookie)
    expect(after.statusCode).toBe(200)
    const body = after.json()
    expect(body.clients.map((c: { id: string }) => c.id)).not.toContain('cTree')
    expect(body.projects.map((p: { id: string }) => p.id)).not.toContain('pTree')
    expect(body.phases.map((p: { id: string }) => p.id)).not.toContain('phTree')
    expect(body.activities.map((a: { id: string }) => a.id)).not.toContain('actTree')
    expect(body.allocations.map((a: { id: string }) => a.id)).not.toContain('alTree')
    // The resource itself is unbound, not deleted (the cascade only drops the activity's allocations).
    expect(body.resources.map((r: { id: string }) => r.id)).toContain('rTree')
  })
})

describe('P2.5a lifecycle — resource soft-delete obfuscation persists (P2.3 carry-forward)', () => {
  const SENTINEL_NAME = 'SENTINEL_PERSON_NAME_XYZ'

  it('archive→delete a resource scrubs name server-side; sentinel appears nowhere in the read body', async () => {
    const { app, db } = await appWithAuth()
    const d = emptyAppData() as unknown as Record<string, unknown[]>
    d.accounts = [account('a1')]
    d.resources = [person('rSent', 'a1', { name: SENTINEL_NAME })]
    insertAll(db, d as unknown as AppData)

    const { cookie, userId } = await signUp(app, 'obfuscate@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'admin', status: 'active', createdAt: TS })

    expect((await lifecycleAction(app, 'resources', 'rSent', 'archive', 'a1', cookie)).statusCode).toBe(200)
    const del = await lifecycleAction(app, 'resources', 'rSent', 'delete', 'a1', cookie)
    expect(del.statusCode).toBe(200)
    // The route's own response already carries the scrubbed name.
    expect(del.json().name).toMatch(/^Removed person #/)
    expect(del.body).not.toContain(SENTINEL_NAME)

    // The PERSISTED row (read back with includeInactive=1) is scrubbed, and the sentinel string never
    // serializes anywhere in the raw response body — proof the scrub is server-side, not a client hide.
    const after = await readInactive(app, 'a1', cookie)
    expect(after.statusCode).toBe(200)
    const row = after.json().resources.find((r: { id: string }) => r.id === 'rSent')
    expect(row.name).toMatch(/^Removed person #/)
    expect(row.deletedAt).toBeTruthy() // the tombstone is set…
    expect(row.archivedAt).toBeTruthy() // …and archivedAt (set by the prior archive) is preserved.
    expect(after.body).not.toContain(SENTINEL_NAME)
  })
})

describe('P2.5a lifecycle — built-in Internal client cannot be archived/deleted/purged', () => {
  it.each(['archive', 'delete', 'purge'] as const)('%s on the built-in Internal client → 409', async (action) => {
    const { app, db } = await appWithAuth()
    seedStates(db)
    const { cookie, userId } = await signUp(app, `builtin-${action}@capacitylens.dev`)
    upsertMember(db, { accountId: 'a1', userId, role: 'admin', status: 'active', createdAt: TS })

    const res = await lifecycleAction(app, 'clients', INTERNAL.id, action, 'a1', cookie)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/built-in Internal client/)
  })
})

describe('P2.5a lifecycle — OFF mode is allow-all (the #1 invariant)', () => {
  function offApp(): { app: FastifyInstance; db: Db } {
    const db = openDb(':memory:')
    const app = buildApp(db)
    seedStates(db)
    return { app, db }
  }

  it('every lifecycle route + read-inactive succeeds with NO auth cookie', async () => {
    const { app } = offApp()
    expect((await lifecycleAction(app, 'clients', 'c1', 'archive', 'a1')).statusCode).toBe(200)
    expect((await lifecycleAction(app, 'clients', 'cArc', 'unarchive', 'a1')).statusCode).toBe(200)
    expect((await lifecycleAction(app, 'resources', 'rArc', 'delete', 'a1')).statusCode).toBe(200)
    expect((await lifecycleAction(app, 'resources', 'rDel', 'purge', 'a1')).statusCode).toBe(204)
    expect((await readInactive(app, 'a1')).statusCode).toBe(200)
  })
})

describe('P2.5a lifecycle — cross-tenant: a1 member acting on a2 row → 403/404', () => {
  it('a member of a1 only → archiving a2 (asserting accountId=a2) → 403; asserting a1 over a2 id → 404', async () => {
    const { app, db } = await appWithAuth()
    seedStates(db)
    const { cookie, userId } = await signUp(app, 'xtenant-lc@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'admin', status: 'active', createdAt: TS })

    // Claiming accountId=a2 (the row's real owner) → not a member of a2 → 403.
    expect((await lifecycleAction(app, 'clients', 'c2', 'archive', 'a2', cookie)).statusCode).toBe(403)
    // Claiming accountId=a1 (where they ARE a member) for a2's row id → the a1 slice has no such row → 404.
    expect((await lifecycleAction(app, 'clients', 'c2', 'archive', 'a1', cookie)).statusCode).toBe(404)
  })
})

describe('P2.5a lifecycle — read-modify-write preserves UNRELATED siblings (whole-slice round-trip)', () => {
  // The routes mutate ONE row by reading the WHOLE account slice with
  // { includeTimeOffNote: true, includeInactive: true }, editing the target, then writing the ENTIRE
  // slice back via replaceAccountSlice (a delete-all + re-insert). So every read-opt is LOAD-BEARING:
  // narrow includeInactive and the unrelated archived/tombstone siblings vanish on persist; narrow
  // includeTimeOffNote and every sibling time-off note is blanked. This guards BOTH so a future edit
  // that drops EITHER opt fails the suite.
  const TIMEOFF_NOTE = 'PRESERVE_ME_TIMEOFF_NOTE_QPR'

  it('archiving one active row leaves an unrelated archived row, a tombstone, and a time-off note intact', async () => {
    const db = openDb(':memory:')
    const app = buildApp(db) // OFF mode: allow-all, and the read returns the time-off note (includeTimeOffNote)
    const d = emptyAppData() as unknown as Record<string, unknown[]>
    d.accounts = [account('a1')]
    d.resources = [
      person('rActive', 'a1'), // the mutation target (active → archived)
      person('rArc', 'a1', justArchived), // UNRELATED already-archived sibling (archivedAt must survive)
      person('rDel', 'a1', archivedTombstone), // UNRELATED soft-delete tombstone (deletedAt must survive)
    ]
    // A time-off row on the UNTOUCHED active resource, carrying a non-empty note that readSlice
    // redacts unless includeTimeOffNote:true — the field a narrowed read would silently blank on write-back.
    d.timeOff = [
      {
        id: 'to1',
        accountId: 'a1',
        resourceId: 'rActive',
        startDate: '2026-03-02',
        endDate: '2026-03-06',
        type: 'holiday',
        note: TIMEOFF_NOTE,
        ...meta(),
      },
    ]
    insertAll(db, d as unknown as AppData)

    // Mutate a DIFFERENT, active row — this triggers the read-whole-slice / replaceAccountSlice round-trip.
    expect((await lifecycleAction(app, 'resources', 'rActive', 'archive', 'a1')).statusCode).toBe(200)

    // Admin read (includeInactive=1) so the inactive siblings are visible to assert against.
    const after = await readInactive(app, 'a1')
    expect(after.statusCode).toBe(200)
    const body = after.json()
    const byId = (id: string) => body.resources.find((r: { id: string }) => r.id === id)

    // (a) the unrelated ARCHIVED sibling still carries its archivedAt (includeInactive guard #1).
    expect(byId('rArc').archivedAt).toBe(TS)
    // (b) the unrelated TOMBSTONE still carries its deletedAt (includeInactive guard #2 — a narrowed
    //     read would have dropped this row entirely and replaceAccountSlice would have erased it).
    expect(byId('rDel').deletedAt).toBe(THIRTY_ONE_DAYS_AGO)
    // (c) the time-off note SURVIVES the round-trip (includeTimeOffNote guard — a narrowed read would
    //     strip the note before write-back, permanently blanking it).
    const to = body.timeOff.find((t: { id: string }) => t.id === 'to1')
    expect(to.note).toBe(TIMEOFF_NOTE)
  })
})

describe('P2.5a lifecycle — audit line (file sink, OFF mode)', () => {
  it('an archive emits one audit line: action "archive", changedFields ["archivedAt"], no value leak', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'capacitylens-lc-audit-'))
    const file = join(dir, 'audit.jsonl')
    const db = openDb(':memory:')
    const app = buildApp(db, { audit: fileAuditSink(file, () => {}) })
    // A resource whose name is a sentinel — to prove the audit line carries the field NAME, not the value.
    const SENTINEL = 'AUDIT_SENTINEL_NAME'
    const d = emptyAppData() as unknown as Record<string, unknown[]>
    d.accounts = [account('a1')]
    d.resources = [person('rA', 'a1', { name: SENTINEL })]
    insertAll(db, d as unknown as AppData)

    expect((await lifecycleAction(app, 'resources', 'rA', 'archive', 'a1')).statusCode).toBe(200)

    const lines = existsSync(file)
      ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as AuditRecord)
      : []
    expect(lines).toHaveLength(1)
    const rec = lines[0]
    expect(rec.action).toBe('archive')
    expect(rec.entity).toBe('resources')
    expect(rec.id).toBe('rA')
    expect(rec.accountId).toBe('a1')
    expect(rec.userId).toBe('demo') // DEMO_USER in OFF mode
    expect(rec.changedFields).toEqual(['archivedAt'])
    // No value leak: the sentinel name never reaches the audit line.
    expect(readFileSync(file, 'utf8')).not.toContain(SENTINEL)
  })

  it('a resource soft-delete emits action "softDelete", changedFields ["deletedAt","name"], no name leak', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'capacitylens-lc-audit-del-'))
    const file = join(dir, 'audit.jsonl')
    const db = openDb(':memory:')
    const app = buildApp(db, { audit: fileAuditSink(file, () => {}) })
    // An ALREADY-ARCHIVED resource (delete requires prior archival) whose name is a unique sentinel —
    // the delete route both obfuscates the name AND audits 'name' as a field NAME; neither must leak the value.
    const SENTINEL = 'AUDIT_DELETE_SENTINEL_NAME'
    const d = emptyAppData() as unknown as Record<string, unknown[]>
    d.accounts = [account('a1')]
    d.resources = [person('rDelAudit', 'a1', { name: SENTINEL, ...justArchived })]
    insertAll(db, d as unknown as AppData)

    expect((await lifecycleAction(app, 'resources', 'rDelAudit', 'delete', 'a1')).statusCode).toBe(200)

    const lines = existsSync(file)
      ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as AuditRecord)
      : []
    expect(lines).toHaveLength(1)
    const rec = lines[0]
    expect(rec.action).toBe('softDelete')
    expect(rec.entity).toBe('resources')
    expect(rec.id).toBe('rDelAudit')
    expect(rec.accountId).toBe('a1')
    expect(rec.userId).toBe('demo') // DEMO_USER in OFF mode
    // The audit carries the obfuscated field's NAME ('name'), never the scrubbed value.
    expect(rec.changedFields).toEqual(['deletedAt', 'name'])
    // No value leak: the original (PII) name never reaches the audit line.
    expect(readFileSync(file, 'utf8')).not.toContain(SENTINEL)
  })
})

describe('P2.1 write guards — generic writes cannot forge tombstones or un-flag the Internal client', () => {
  // Two integrity guards keeping the GENERIC write path (POST/PUT/PATCH/batch) from bypassing the
  // dedicated lifecycle routes: (1) sanitizeWrite PINS archivedAt/deletedAt to the stored row, so a
  // crafted body can neither SET a tombstone on an active row (skipping the archived-first interlock +
  // the resource-name PII scrub, and — with a back-dated deletedAt — making it instantly purgeable) NOR
  // CLEAR an existing one via an unrelated edit (which would silently RESURRECT an archived/soft-deleted
  // row — there is no un-delete route anywhere), and (2) validateWrite refuses to convert the built-in
  // Internal client back to a regular one. OFF mode is used (authorize is a no-op there), so these prove
  // the SANITIZE/VALIDATE layer itself, independent of the auth gate.

  const offAppWith = (data: Partial<Record<string, unknown[]>>): { app: FastifyInstance; db: Db } => {
    const db = openDb(':memory:')
    const app = buildApp(db)
    insertAll(db, { ...emptyAppData(), ...data } as unknown as AppData)
    return { app, db }
  }

  const rowById = async (app: FastifyInstance, entity: 'resources' | 'clients', accountId: string, id: string) => {
    const res = await readInactive(app, accountId) // includeInactive so a (wrongly) tombstoned row still shows
    expect(res.statusCode).toBe(200)
    return (res.json()[entity] as Array<{ id: string }>).find((e) => e.id === id) as Record<string, unknown> | undefined
  }

  it('PATCH cannot set deletedAt/archivedAt on a resource (stripped; row stays active)', async () => {
    const { app } = offAppWith({ accounts: [account('a1')], resources: [person('r1', 'a1')] })
    const res = await call(app, {
      method: 'PATCH',
      url: '/api/resources/r1',
      payload: { deletedAt: '2020-01-01T00:00:00.000Z', archivedAt: '2020-01-01T00:00:00.000Z' },
    })
    expect(res.statusCode).toBe(200)
    const r1 = await rowById(app, 'resources', 'a1', 'r1')
    expect(r1?.deletedAt).toBeUndefined()
    expect(r1?.archivedAt).toBeUndefined()
    // Still ACTIVE: it appears in the DEFAULT (active-only) read too — the forged delete never took.
    const active = await call(app, { method: 'GET', url: '/api/state?accountId=a1' })
    expect((active.json().resources as Array<{ id: string }>).some((r) => r.id === 'r1')).toBe(true)
  })

  it('PUT cannot set deletedAt on a client (stripped)', async () => {
    const { app } = offAppWith({ accounts: [account('a1')], clients: [client('c1', 'a1')] })
    const res = await call(app, {
      method: 'PUT',
      url: '/api/clients/c1',
      payload: client('c1', 'a1', { deletedAt: '2020-01-01T00:00:00.000Z' }),
    })
    expect(res.statusCode).toBe(200)
    expect((await rowById(app, 'clients', 'a1', 'c1'))?.deletedAt).toBeUndefined()
  })

  it('PATCH {builtin:false} on the Internal client → 400 (cannot un-flag the singleton)', async () => {
    const { app } = offAppWith({ accounts: [account('a1')], clients: [INTERNAL, client('c1', 'a1')] })
    const res = await call(app, { method: 'PATCH', url: `/api/clients/${INTERNAL.id}`, payload: { builtin: false } })
    expect(res.statusCode).toBe(400)
    // The flag survived — the singleton is intact.
    expect((await rowById(app, 'clients', 'a1', INTERNAL.id))?.builtin).toBe(true)
    // A regular client still updates normally (control — the guard is surgical, not a blanket clients lock).
    const ok = await call(app, { method: 'PATCH', url: '/api/clients/c1', payload: { name: 'Renamed' } })
    expect(ok.statusCode).toBe(200)
  })

  // The OTHER direction of the pin (regression: the strip used to be blind, so an unrelated edit on a
  // tombstoned row NULLed the tombstone and resurrected the row). archive/delete set the tombstone via
  // the dedicated route; a subsequent generic edit must leave it intact.
  it('PATCH of an unrelated field on an ARCHIVED resource preserves the tombstone (no resurrection)', async () => {
    const { app } = offAppWith({ accounts: [account('a1')], resources: [person('r1', 'a1')] })
    expect((await lifecycleAction(app, 'resources', 'r1', 'archive', 'a1')).statusCode).toBe(200)
    // Edit an unrelated field — the body never mentions archivedAt, but the merge spreads the stored
    // tombstone, and a blind strip would clear it. The pin keeps it.
    const res = await call(app, { method: 'PATCH', url: '/api/resources/r1', payload: { role: 'Senior Designer' } })
    expect(res.statusCode).toBe(200)
    const r1 = await rowById(app, 'resources', 'a1', 'r1')
    expect(typeof r1?.archivedAt).toBe('string') // tombstone survived the edit
    expect(r1?.role).toBe('Senior Designer') // the legit field DID change
    // Still ARCHIVED: absent from the DEFAULT (active-only) read — it was NOT resurrected.
    const active = await call(app, { method: 'GET', url: '/api/state?accountId=a1' })
    expect((active.json().resources as Array<{ id: string }>).some((r) => r.id === 'r1')).toBe(false)
  })

  it('PATCH of an unrelated field on a SOFT-DELETED client preserves BOTH tombstones (worst case: no un-delete route exists)', async () => {
    const { app } = offAppWith({ accounts: [account('a1')], clients: [client('c1', 'a1')] })
    // archived-first interlock, then soft-delete: the row now carries deletedAt (and archivedAt).
    expect((await lifecycleAction(app, 'clients', 'c1', 'archive', 'a1')).statusCode).toBe(200)
    expect((await lifecycleAction(app, 'clients', 'c1', 'delete', 'a1')).statusCode).toBe(200)
    const before = await rowById(app, 'clients', 'a1', 'c1')
    expect(typeof before?.deletedAt).toBe('string') // really soft-deleted

    const res = await call(app, { method: 'PATCH', url: '/api/clients/c1', payload: { color: '#ff00ff' } })
    expect(res.statusCode).toBe(200)
    const after = await rowById(app, 'clients', 'a1', 'c1')
    expect(after?.deletedAt).toBe(before?.deletedAt) // soft-delete tombstone intact
    expect(after?.archivedAt).toBe(before?.archivedAt) // archive tombstone intact
    expect(after?.color).toBe('#ff00ff') // the legit field DID change
    // Still DELETED: absent from the DEFAULT (active-only) read — not resurrected.
    const active = await call(app, { method: 'GET', url: '/api/state?accountId=a1' })
    expect((active.json().clients as Array<{ id: string }>).some((c) => c.id === 'c1')).toBe(false)
  })

  it('PUT and batch-PUT with a body that OMITS the tombstone do not clear an existing one', async () => {
    const { app } = offAppWith({ accounts: [account('a1')], resources: [person('rPut', 'a1'), person('rBatch', 'a1')] })
    expect((await lifecycleAction(app, 'resources', 'rPut', 'archive', 'a1')).statusCode).toBe(200)
    expect((await lifecycleAction(app, 'resources', 'rBatch', 'archive', 'a1')).statusCode).toBe(200)

    // PUT the FULL row (person() omits archivedAt): pre-fix this NULLed the column; now it's pinned.
    const put = await call(app, { method: 'PUT', url: '/api/resources/rPut', payload: person('rPut', 'a1', { role: 'Lead' }) })
    expect(put.statusCode).toBe(200)
    expect(typeof (await rowById(app, 'resources', 'a1', 'rPut'))?.archivedAt).toBe('string')

    // Same via the batch sync path (the real client verb) — the changed call site is covered too.
    const batch = await call(app, {
      method: 'POST',
      url: '/api/batch',
      payload: { ops: [{ method: 'PUT', table: 'resources', id: 'rBatch', row: person('rBatch', 'a1', { role: 'Lead' }) }] },
    })
    expect(batch.statusCode).toBe(200)
    expect(typeof (await rowById(app, 'resources', 'a1', 'rBatch'))?.archivedAt).toBe('string')
  })
})
