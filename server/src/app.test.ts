import { describe, it, expect } from 'vitest'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import { buildApp, statusFor } from './app'
import { ValidationError } from './validate'
import { openDb } from './db'
import {
  FIXTURE_ACCOUNT,
  FIXTURE_CLIENT,
  FIXTURE_DISCIPLINE,
  FIXTURE_PROJECT,
  FIXTURE_PHASE,
  FIXTURE_RESOURCE,
  FIXTURE_RESOURCE_EXTERNAL,
  FIXTURE_TASK,
  FIXTURE_ALLOCATION,
  FIXTURE_TIMEOFF,
} from '@floaty/shared/data/fixtures'

// API integration tests: drive the real Fastify app + a real (in-memory) node:sqlite
// DB via inject(). Covers CRUD, whole-state read, cascade deletes, import round-trip,
// migration reuse, and the validation rules — which run the SAME shared domain-core
// the client uses, so passing here proves "server validation == client validation".

const TS = '2026-01-01T00:00:00.000Z'
const meta = () => ({ createdAt: TS, updatedAt: TS })

function freshApp(allowReset = true): { app: FastifyInstance } {
  return { app: buildApp(openDb(':memory:'), { allowReset }) }
}

const account = (id: string) => ({ id, name: 'Studio', color: '#3b82f6', ...meta() })
const client = (id: string, accountId: string) => ({ id, accountId, name: 'Acme', color: '#3b82f6', ...meta() })
const project = (id: string, accountId: string, clientId: string) => ({ id, accountId, name: 'Web', clientId, color: '#3b82f6', ...meta() })
const task = (id: string, accountId: string, projectId: string, phaseId?: string) => ({ id, accountId, name: 'Task', projectId, phaseId, ...meta() })
const person = (id: string, accountId: string) => ({
  id,
  accountId,
  kind: 'person',
  role: 'Designer',
  employmentType: 'permanent',
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  color: '#3b82f6',
  ...meta(),
})
const placeholder = (id: string, accountId: string, projectId?: string) => ({ ...person(id, accountId), kind: 'placeholder', projectId })
const allocation = (id: string, accountId: string, resourceId: string, taskId: string, o: Record<string, unknown> = {}) =>
  // Object.assign (rather than `{ ...base, ...o }`) so overriding well-known keys via
  // `o` doesn't trip TS2783 on the literal's explicit startDate/endDate/etc.
  Object.assign(
    { id, accountId, resourceId, taskId, startDate: '2026-01-01', endDate: '2026-01-05', hoursPerDay: 8, status: 'confirmed', ...meta() },
    o,
  )

// app.inject's overloads resolve to a union that hides statusCode/json; this wrapper
// pins the single Promise-returning shape so call sites stay terse.
const call = (app: FastifyInstance, opts: InjectOptions): Promise<LightMyRequestResponse> =>
  app.inject(opts) as unknown as Promise<LightMyRequestResponse>
const body = (payload: unknown) => payload as InjectOptions['payload']

const post = (app: FastifyInstance, entity: string, payload: unknown) =>
  call(app, { method: 'POST', url: `/api/${entity}`, payload: body(payload) })
const put = (app: FastifyInstance, entity: string, id: string, payload: unknown) =>
  call(app, { method: 'PUT', url: `/api/${entity}/${id}`, payload: body(payload) })
const patch = (app: FastifyInstance, entity: string, id: string, payload: unknown) =>
  call(app, { method: 'PATCH', url: `/api/${entity}/${id}`, payload: body(payload) })
// Scoped tables now REQUIRE an asserted owning account on DELETE; pass accountId for them.
// accounts (top-level) carry none, so accountId is omitted there.
const del = (app: FastifyInstance, entity: string, id: string, accountId?: string) =>
  call(app, {
    method: 'DELETE',
    url: accountId ? `/api/${entity}/${id}?accountId=${accountId}` : `/api/${entity}/${id}`,
  })
const batch = (app: FastifyInstance, ops: unknown[]) =>
  call(app, { method: 'POST', url: '/api/batch', payload: body({ ops }) })
const state = async (app: FastifyInstance) => (await call(app, { method: 'GET', url: '/api/state' })).json()

/** Seed a minimal account → client → project → task → person chain. */
async function scaffold(app: FastifyInstance) {
  await post(app, 'accounts', account('a1'))
  await post(app, 'clients', client('c1', 'a1'))
  await post(app, 'projects', project('p1', 'a1', 'c1'))
  await post(app, 'tasks', task('t1', 'a1', 'p1'))
  await post(app, 'resources', person('r1', 'a1'))
}

describe('health + state', () => {
  it('reports health and starts empty', async () => {
    const { app } = freshApp()
    expect((await call(app, { method: 'GET', url: '/api/health' })).json()).toEqual({ ok: true })
    const s = await state(app)
    expect(s.accounts).toEqual([])
    expect((await call(app, { method: 'GET', url: '/api/meta' })).json()).toEqual({ hasData: false })
  })
})

describe('CRUD round-trip', () => {
  it('creates every entity type and reads them back via /api/state', async () => {
    const { app } = freshApp()
    await scaffold(app)
    expect((await post(app, 'allocations', allocation('al1', 'a1', 'r1', 't1'))).statusCode).toBe(201)
    const s = await state(app)
    expect(s.accounts).toHaveLength(1)
    expect(s.clients).toHaveLength(1)
    expect(s.projects).toHaveLength(1)
    expect(s.tasks).toHaveLength(1)
    expect(s.resources).toHaveLength(1)
    expect(s.allocations).toHaveLength(1)
    // Round-trips exactly: workingDays json + omitted optionals survive.
    expect(s.resources[0]).toEqual(person('r1', 'a1'))
    expect(s.allocations[0]).toEqual(allocation('al1', 'a1', 'r1', 't1'))
  })

  it('PATCH updates fields; DELETE removes', async () => {
    const { app } = freshApp()
    await scaffold(app)
    const res = await patch(app, 'clients', 'c1', { ...client('c1', 'a1'), name: 'Renamed' })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('Renamed')
    expect((await del(app, 'clients', 'c1', 'a1')).statusCode).toBe(204)
    expect((await state(app)).clients).toHaveLength(0)
  })

  it('PATCH on a missing id is 404; unknown entity is 404', async () => {
    const { app } = freshApp()
    await scaffold(app)
    expect((await patch(app, 'clients', 'nope', client('nope', 'a1'))).statusCode).toBe(404)
    expect((await post(app, 'widgets', { id: 'x' })).statusCode).toBe(404)
  })

  it('PATCH is a partial merge: omitted fields keep their stored value', async () => {
    const { app } = freshApp()
    await scaffold(app)
    // A real partial patch — only `role`. kind/employmentType/workingDays/etc. must
    // survive (a blind column-wise UPDATE would null the NOT NULL columns → 500/400).
    const res = await patch(app, 'resources', 'r1', { role: 'Lead Designer' })
    expect(res.statusCode).toBe(200)
    const s = await state(app)
    const r = s.resources[0]
    expect(r.role).toBe('Lead Designer')
    expect(r.kind).toBe('person')
    expect(r.employmentType).toBe('permanent')
    expect(r.workingHoursPerDay).toBe(8)
    expect(r.workingDays).toEqual([1, 2, 3, 4, 5])
    expect(r.color).toBe('#3b82f6')
  })

  it('refuses to re-home an existing row to another account (accountId is immutable)', async () => {
    const { app } = freshApp()
    await scaffold(app) // c1 in a1
    await post(app, 'accounts', account('a2'))
    // PATCH and PUT that try to move c1 into a2 are both rejected with 409…
    expect((await patch(app, 'clients', 'c1', { accountId: 'a2' })).statusCode).toBe(409)
    expect((await put(app, 'clients', 'c1', { ...client('c1', 'a2') })).statusCode).toBe(409)
    // …and c1 stays in a1.
    expect((await state(app)).clients[0].accountId).toBe('a1')
  })

  it('scopes a delete to its owning account: a cross-account delete is refused (404), the row stays', async () => {
    const { app } = freshApp()
    await scaffold(app) // c1 belongs to a1
    await post(app, 'accounts', account('a2'))
    // Asserting the WRONG account (a2) refuses with 404 and leaves c1 in place…
    expect((await call(app, { method: 'DELETE', url: '/api/clients/c1?accountId=a2' })).statusCode).toBe(404)
    expect((await state(app)).clients).toHaveLength(1)
    // …the correct owner deletes it.
    expect((await call(app, { method: 'DELETE', url: '/api/clients/c1?accountId=a1' })).statusCode).toBe(204)
    expect((await state(app)).clients).toHaveLength(0)
  })

  it('refuses a scoped delete that omits accountId (the by-id bypass is closed → 400)', async () => {
    const { app } = freshApp()
    await scaffold(app)
    // A scoped delete MUST assert its owner; omitting accountId can't prove ownership, so
    // it is a 400 rather than an unscoped delete-by-id (the old tenant-guard bypass).
    expect((await call(app, { method: 'DELETE', url: '/api/clients/c1' })).statusCode).toBe(400)
    expect((await state(app)).clients).toHaveLength(1) // not deleted
  })

  it('preserves the immutable createdAt on update (a PUT cannot rewrite it)', async () => {
    const { app } = freshApp()
    await scaffold(app)
    const original = (await state(app)).clients[0].createdAt
    await put(app, 'clients', 'c1', { ...client('c1', 'a1'), name: 'Renamed', createdAt: '2099-01-01T00:00:00.000Z' })
    const after = (await state(app)).clients[0]
    expect(after.name).toBe('Renamed') // everything else updates
    expect(after.createdAt).toBe(original) // …but createdAt is preserved
  })

  it('reports hasData:true after the user deletes all their data (no demo re-seed)', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', account('a1'))
    expect((await call(app, { method: 'GET', url: '/api/meta' })).json()).toEqual({ hasData: true })
    await del(app, 'accounts', 'a1') // user empties everything
    expect((await state(app)).accounts).toHaveLength(0)
    // Still "initialised" — a reload must NOT mistake an emptied dataset for a fresh one.
    expect((await call(app, { method: 'GET', url: '/api/meta' })).json()).toEqual({ hasData: true })
  })

  it('DELETE is idempotent (missing id still 204 when the owner is asserted)', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', account('a1'))
    expect((await del(app, 'clients', 'ghost', 'a1')).statusCode).toBe(204)
  })

  it('PUT upserts idempotently: first call creates, second overwrites (no conflict)', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', account('a1'))
    const c = client('c1', 'a1')
    expect((await put(app, 'clients', 'c1', c)).statusCode).toBe(200)
    // Replay the SAME create — must not error (the sync adapter relies on this when
    // replaying a batch after a partial failure).
    expect((await put(app, 'clients', 'c1', c)).statusCode).toBe(200)
    // A changed body overwrites.
    expect((await put(app, 'clients', 'c1', { ...c, name: 'Renamed' })).statusCode).toBe(200)
    const s = await state(app)
    expect(s.clients).toHaveLength(1)
    expect(s.clients[0].name).toBe('Renamed')
  })

  it('PUT rejects a body id that disagrees with the URL id', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', account('a1'))
    expect((await put(app, 'clients', 'c1', client('OTHER', 'a1'))).statusCode).toBe(400)
  })

  it('PUT runs shared-core validation (rejects a dangling FK)', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', account('a1'))
    expect((await put(app, 'projects', 'p1', project('p1', 'a1', 'no-client'))).statusCode).toBe(400)
  })
})

describe('cascade deletes (DB foreign keys mirror the store cascades)', () => {
  it('deleting a client cascades to projects, tasks and allocations but not resources', async () => {
    const { app } = freshApp()
    await scaffold(app)
    await post(app, 'allocations', allocation('al1', 'a1', 'r1', 't1'))
    await del(app, 'clients', 'c1', 'a1')
    const s = await state(app)
    expect(s.clients).toHaveLength(0)
    expect(s.projects).toHaveLength(0)
    expect(s.tasks).toHaveLength(0)
    expect(s.allocations).toHaveLength(0)
    expect(s.resources).toHaveLength(1) // resource survives
  })

  it('deleting a discipline ungroups resources (SET NULL, not delete)', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', account('a1'))
    await post(app, 'disciplines', { id: 'd1', accountId: 'a1', name: 'Design', sortOrder: 0, ...meta() })
    await post(app, 'resources', { ...person('r1', 'a1'), disciplineId: 'd1' })
    await del(app, 'disciplines', 'd1', 'a1')
    const s = await state(app)
    expect(s.disciplines).toHaveLength(0)
    expect(s.resources).toHaveLength(1)
    expect(s.resources[0].disciplineId).toBeUndefined()
  })
})

describe('batch sync (/api/batch — transactional, ordered)', () => {
  it('reparent + delete of the OLD parent in one batch preserves the moved subtree', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', account('a1'))
    await post(app, 'clients', client('c1', 'a1'))
    await post(app, 'clients', client('c2', 'a1'))
    await post(app, 'projects', project('p1', 'a1', 'c1')) // p1 under c1
    await post(app, 'tasks', task('t1', 'a1', 'p1'))
    // One batch: move p1 to c2 (upsert), then delete c1. Upserts-before-deletes inside a
    // single tx means p1's new clientId lands BEFORE c1's ON DELETE CASCADE runs — so p1
    // and its descendant t1 survive (the bug this fix closes would cascade-delete them).
    const res = await batch(app, [
      { method: 'PUT', table: 'projects', id: 'p1', row: { ...project('p1', 'a1', 'c2'), updatedAt: '2026-02-01T00:00:00.000Z' } },
      { method: 'DELETE', table: 'clients', id: 'c1', accountId: 'a1' },
    ])
    expect(res.statusCode).toBe(200)
    const s = await state(app)
    expect(s.clients.map((c: { id: string }) => c.id)).toEqual(['c2'])
    expect(s.projects).toHaveLength(1)
    expect(s.projects[0].clientId).toBe('c2') // reparented, not cascade-deleted
    expect(s.tasks).toHaveLength(1) // descendant preserved
  })

  it('rolls the WHOLE batch back if any op fails (atomic)', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', account('a1'))
    // First op valid (new client c3); second references a missing client → validation 400.
    const res = await batch(app, [
      { method: 'PUT', table: 'clients', id: 'c3', row: client('c3', 'a1') },
      { method: 'PUT', table: 'projects', id: 'bad', row: project('bad', 'a1', 'ghost-client') },
    ])
    expect(res.statusCode).toBe(400)
    const s = await state(app)
    expect(s.clients).toHaveLength(0) // c3 rolled back with the bad op — nothing persisted
    expect(s.projects).toHaveLength(0)
  })

  it('refuses a cross-account delete inside a batch and rolls back', async () => {
    const { app } = freshApp()
    await scaffold(app) // c1 in a1
    await post(app, 'accounts', account('a2'))
    const res = await batch(app, [{ method: 'DELETE', table: 'clients', id: 'c1', accountId: 'a2' }])
    expect(res.statusCode).toBe(400)
    expect((await state(app)).clients).toHaveLength(1) // c1 untouched
  })

  it('rejects a scoped delete op that omits accountId', async () => {
    const { app } = freshApp()
    await scaffold(app)
    const res = await batch(app, [{ method: 'DELETE', table: 'clients', id: 'c1' }])
    expect(res.statusCode).toBe(400)
    expect((await state(app)).clients).toHaveLength(1)
  })

  it('rejects an unknown table / bad op shape', async () => {
    const { app } = freshApp()
    expect((await batch(app, [{ method: 'PUT', table: 'widgets', id: 'x', row: { id: 'x' } }])).statusCode).toBe(400)
    expect((await batch(app, [{ method: 'PUT', table: 'clients', id: 'c1', row: { id: 'OTHER' } }])).statusCode).toBe(400)
    expect((await call(app, { method: 'POST', url: '/api/batch', payload: body({ nope: true }) })).statusCode).toBe(400)
  })
})

describe('validation (shared domain-core) rejects bad writes with 400', () => {
  it('rejects a project referencing a client outside the account', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', account('a1'))
    const res = await post(app, 'projects', project('p1', 'a1', 'no-such-client'))
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/client/i)
  })

  it('rejects a reversed allocation date range', async () => {
    const { app } = freshApp()
    await scaffold(app)
    const res = await post(app, 'allocations', allocation('bad', 'a1', 'r1', 't1', { startDate: '2026-02-10', endDate: '2026-02-01' }))
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/end date/i)
  })

  it('rejects a placeholder assigned outside its bound project', async () => {
    const { app } = freshApp()
    await scaffold(app)
    await post(app, 'projects', project('p2', 'a1', 'c1'))
    await post(app, 'tasks', task('t2', 'a1', 'p2'))
    await post(app, 'resources', placeholder('ph', 'a1', 'p1')) // bound to p1
    const res = await post(app, 'allocations', allocation('al', 'a1', 'ph', 't2')) // t2 is in p2
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/placeholder/i)
  })

  it('rejects an allocation referencing a missing resource/task', async () => {
    const { app } = freshApp()
    await scaffold(app)
    const res = await post(app, 'allocations', allocation('al', 'a1', 'ghost', 't1'))
    expect(res.statusCode).toBe(400)
  })
})

describe('import', () => {
  const exportFile = (accountId: string) => ({
    schemaVersion: 3,
    data: {
      accounts: [],
      clients: [client('src-c', accountId)],
      disciplines: [],
      projects: [project('src-p', accountId, 'src-c')],
      phases: [],
      resources: [person('src-r', accountId)],
      tasks: [task('src-t', accountId, 'src-p')],
      allocations: [
        allocation('src-al', accountId, 'src-r', 'src-t'),
        allocation('bad', accountId, 'src-r', 'no-task'), // dropped: dangling task
      ],
      timeOff: [],
    },
  })

  it('imports into an account with fresh ids + remapped FKs, dropping invalid rows', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', account('a1'))
    const res = await call(app, { method: 'POST', url: '/api/import', payload: { accountId: 'a1', data: exportFile('whatever') } })
    expect(res.statusCode).toBe(200)
    const out = res.json()
    expect(out.imported).toBe(5) // client, project, resource, task, 1 valid allocation
    expect(out.skipped).toBe(1) // the dangling allocation
    const s = await state(app)
    const proj = s.projects[0]
    expect(proj.id).not.toBe('src-p')
    expect(proj.accountId).toBe('a1')
    expect(s.tasks[0].projectId).toBe(proj.id) // FK rewired to the new project id
    expect(s.allocations).toHaveLength(1)
  })

  it('drops records with dangling required FKs and unbinds dangling optional ones', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', account('a1'))
    // A hand-edited file: a project/phase whose required parent is absent (must be
    // dropped before SQLite's FKs reject the whole import), and a task/resource whose
    // OPTIONAL parent is absent (must survive, unbound to general / no discipline).
    const file = {
      schemaVersion: 3,
      data: {
        accounts: [],
        clients: [],
        disciplines: [],
        projects: [project('dp', 'x', 'ghost-client')], // dropped: missing client
        phases: [{ id: 'dph', accountId: 'x', name: 'P', projectId: 'ghost-project', ...meta() }], // dropped
        resources: [{ ...person('dr', 'x'), disciplineId: 'ghost-disc' }], // kept, discipline unbound
        tasks: [task('dt', 'x', 'ghost-project')], // kept, unbound to a general task
        allocations: [],
        timeOff: [],
      },
    }
    const res = await call(app, { method: 'POST', url: '/api/import', payload: { accountId: 'a1', data: file } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ imported: 2, skipped: 2 })
    const s = await state(app)
    expect(s.projects).toHaveLength(0)
    expect(s.phases).toHaveLength(0)
    expect(s.tasks).toHaveLength(1)
    expect(s.tasks[0].projectId).toBeUndefined() // unbound → general task
    expect(s.resources).toHaveLength(1)
    expect(s.resources[0].disciplineId).toBeUndefined() // unbound discipline
  })

  it('runs the v1→v2 migration on imported data (isFreelancer → employmentType)', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', account('a1'))
    const lr = person('lr', 'x') as Record<string, unknown>
    delete lr.employmentType
    lr.isFreelancer = true
    const legacy = { schemaVersion: 1, data: { resources: [lr] } }
    await call(app, { method: 'POST', url: '/api/import', payload: { accountId: 'a1', data: legacy } })
    const s = await state(app)
    expect(s.resources[0].employmentType).toBe('freelancer')
    expect('isFreelancer' in s.resources[0]).toBe(false)
  })

  it('requires an accountId', async () => {
    const { app } = freshApp()
    expect((await call(app, { method: 'POST', url: '/api/import', payload: { data: {} } })).statusCode).toBe(400)
  })

  it('rejects non-Floaty data', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', account('a1'))
    const res = await call(app, { method: 'POST', url: '/api/import', payload: { accountId: 'a1', data: { nope: true } } })
    expect(res.statusCode).toBe(400)
  })
})

describe('guards', () => {
  it('rejects an oversized payload with 413', async () => {
    const { app } = freshApp()
    const huge = '{"id":"' + 'a'.repeat(6 * 1024 * 1024) + '"}'
    const res = await call(app, { method: 'POST', url: '/api/accounts', headers: { 'content-type': 'application/json' }, payload: huge })
    expect(res.statusCode).toBe(413)
  })

  it('reset is 403 unless allowed, then wipes + re-seeds', async () => {
    const locked = buildApp(openDb(':memory:'), { allowReset: false })
    expect((await call(locked, { method: 'POST', url: '/api/test/reset', payload: {} })).statusCode).toBe(403)

    const { app } = freshApp(true)
    await scaffold(app)
    await call(app, { method: 'POST', url: '/api/test/reset', payload: { seed: true } })
    const s = await state(app)
    expect(s.accounts.length).toBeGreaterThan(0) // seeded demo data present
  })
})

describe('value-level sanitization on direct writes (server is the integrity boundary)', () => {
  it('repairs junk enums / colour / hours / workingDays on POST instead of persisting them', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', account('a1'))
    // A hand-crafted request that bypasses the UI forms with every value-field wrong.
    const res = await post(app, 'resources', {
      id: 'r1',
      accountId: 'a1',
      kind: 'wizard', // invalid → 'person'
      role: 'Designer',
      employmentType: 'overlord', // invalid → 'permanent'
      workingHoursPerDay: -5, // invalid → 8
      workingDays: 'nope', // invalid → [1..5]
      color: 'not-a-colour', // invalid → fallback hex
      ...meta(),
    })
    expect(res.statusCode).toBe(201)
    const r = (await state(app)).resources[0] as Record<string, unknown>
    expect(r.kind).toBe('person')
    expect(r.employmentType).toBe('permanent')
    expect(r.workingHoursPerDay).toBe(8)
    expect(r.workingDays).toEqual([1, 2, 3, 4, 5])
    expect(r.color).toBe('#6366f1')
  })

  it('repairs a bad allocation status / hours on PUT', async () => {
    const { app } = freshApp()
    await scaffold(app)
    const res = await put(app, 'allocations', 'al1', allocation('al1', 'a1', 'r1', 't1', { status: 'maybe', hoursPerDay: -3 }))
    expect(res.statusCode).toBe(200)
    const a = (await state(app)).allocations[0] as Record<string, unknown>
    expect(a.status).toBe('confirmed')
    // A finite out-of-range value clamps to the [0,24] FLOOR (0), matching the shared
    // store clamp — import + store now use one clampHoursPerDay, so they can't diverge.
    // (Only a missing / NaN value falls back to a full 8h day.)
    expect(a.hoursPerDay).toBe(0)
  })

  it('drops a junk account schedulingMode on a direct write but keeps a valid one', async () => {
    const { app } = freshApp()
    // A hand-crafted account write with a junk schedulingMode the scheduler can't handle.
    expect((await post(app, 'accounts', { ...account('a1'), schedulingMode: 'wizard' })).statusCode).toBe(201)
    expect((await state(app)).accounts[0].schedulingMode).toBeUndefined() // junk dropped → 'hourly'
    // A valid mode persists unchanged.
    await patch(app, 'accounts', 'a1', { schedulingMode: 'blocks' })
    expect((await state(app)).accounts[0].schedulingMode).toBe('blocks')
  })
})

describe('scheduling-mode fields round-trip through the DB', () => {
  it('persists account schedulingMode and a block allocation (hoursPerDay 0 + ignoreWeekends)', async () => {
    const { app } = freshApp()
    await scaffold(app)
    // Switch the company into blocks mode.
    expect((await patch(app, 'accounts', 'a1', { schedulingMode: 'blocks' })).statusCode).toBe(200)
    // A block booking persists hoursPerDay 0 (load ignored) + ignoreWeekends true. The
    // 0 must NOT be sanitized up to a full day, and the boolean must round-trip.
    const res = await post(app, 'allocations', allocation('al1', 'a1', 'r1', 't1', { hoursPerDay: 0, ignoreWeekends: true }))
    expect(res.statusCode).toBe(201)
    const s = await state(app)
    expect(s.accounts[0].schedulingMode).toBe('blocks')
    expect(s.allocations[0].hoursPerDay).toBe(0)
    expect(s.allocations[0].ignoreWeekends).toBe(true)
  })
})

describe('error status mapping (statusFor)', () => {
  it('maps validation + constraint errors to 400 and unexpected errors to 500', () => {
    expect(statusFor(new ValidationError('bad ref'))).toBe(400)
    expect(statusFor(new Error('FOREIGN KEY constraint failed'))).toBe(400)
    expect(statusFor(new Error('NOT NULL constraint failed: resources.role'))).toBe(400)
    expect(statusFor(new Error('something unexpected blew up'))).toBe(500)
    expect(statusFor('a string')).toBe(500)
  })

  // PINNING TEST: the 400-vs-500 split rests on node:sqlite spelling constraint errors
  // "<kind> constraint failed". The case above uses fabricated strings; these trigger REAL
  // violations so a library/locale change to that wording fails HERE (a gate failure) instead of
  // silently misclassifying genuine 500s as 400s — or vice versa — in production.
  describe('pins node:sqlite constraint wording on real violations', () => {
    const grab = (fn: () => void): Error => {
      try {
        fn()
      } catch (e) {
        return e as Error
      }
      throw new Error('expected a constraint violation, but none was thrown')
    }

    it('NOT NULL violation still says "constraint failed" → 400', () => {
      const db = openDb(':memory:')
      const e = grab(() =>
        db.exec(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES ('a', NULL, '#fff', 't', 't')`),
      )
      expect(e.message).toMatch(/constraint failed/i)
      expect(statusFor(e)).toBe(400)
    })

    it('UNIQUE/PRIMARY KEY violation still says "constraint failed" → 400', () => {
      const db = openDb(':memory:')
      db.exec(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES ('a', 'Studio', '#fff', 't', 't')`)
      const e = grab(() =>
        db.exec(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES ('a', 'Dup', '#fff', 't', 't')`),
      )
      expect(e.message).toMatch(/constraint failed/i)
      expect(statusFor(e)).toBe(400)
    })

    it('FOREIGN KEY violation still says "constraint failed" → 400', () => {
      const db = openDb(':memory:') // openDb turns foreign_keys ON
      const e = grab(() =>
        db.exec(
          `INSERT INTO clients (id, accountId, name, color, createdAt, updatedAt) VALUES ('c', 'no-such-account', 'Acme', '#fff', 't', 't')`,
        ),
      )
      expect(e.message).toMatch(/constraint failed/i)
      expect(statusFor(e)).toBe(400)
    })
  })
})

describe('CORS allow-list', () => {
  it('defaults FAIL-CLOSED to the localhost allow-list (not a wildcard)', async () => {
    const { app } = freshApp()
    // A local dev origin is reflected (it's on the default allow-list)…
    const local = await call(app, { method: 'GET', url: '/api/health', headers: { origin: 'http://localhost:5173' } })
    expect(local.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    // …but an arbitrary site gets NO ACAO header (the browser blocks it) — the factory
    // never opens to '*' unless explicitly told to.
    const evil = await call(app, { method: 'GET', url: '/api/health', headers: { origin: 'http://evil.test' } })
    expect(evil.headers['access-control-allow-origin']).toBeUndefined()
  })

  it("echoes '*' only when corsOrigin is explicitly '*'", async () => {
    const app = buildApp(openDb(':memory:'), { corsOrigin: '*' })
    const res = await call(app, { method: 'GET', url: '/api/health', headers: { origin: 'http://evil.test' } })
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it('reflects an allowed origin and omits the header for a disallowed one', async () => {
    const app = buildApp(openDb(':memory:'), { corsOrigin: 'http://good.test,http://also.test' })
    const ok = await call(app, { method: 'GET', url: '/api/health', headers: { origin: 'http://good.test' } })
    expect(ok.headers['access-control-allow-origin']).toBe('http://good.test')
    const bad = await call(app, { method: 'GET', url: '/api/health', headers: { origin: 'http://evil.test' } })
    expect(bad.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('pairs Allow-Credentials with a reflected origin, never with the wildcard (P3.4)', async () => {
    // The client sends credentials: 'include' on every request; a credentialed
    // cross-origin response without this header is refused by the browser. With '*'
    // the header must be absent — credentialed wildcards are invalid by spec.
    const { app } = freshApp()
    const reflected = await call(app, { method: 'GET', url: '/api/health', headers: { origin: 'http://localhost:5173' } })
    expect(reflected.headers['access-control-allow-credentials']).toBe('true')
    const wildcard = buildApp(openDb(':memory:'), { corsOrigin: '*' })
    const starred = await call(wildcard, { method: 'GET', url: '/api/health', headers: { origin: 'http://evil.test' } })
    expect(starred.headers['access-control-allow-credentials']).toBeUndefined()
  })

  it('answers a write preflight with 204 + CORS headers (no OPTIONS route exists)', async () => {
    // Regression guard: every cross-origin write (JSON POST/PUT/PATCH/DELETE) is
    // preflighted by the browser, and OPTIONS matches no route — the 204 comes from the
    // ROOT-level onRequest hook on the not-found path. When the hook briefly moved into
    // the routes child plugin, preflights became bare 404s without CORS headers and the
    // db-backed e2e app could no longer save anything.
    const { app } = freshApp()
    const res = await call(app, {
      method: 'OPTIONS',
      url: '/api/batch',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
    })
    expect(res.statusCode).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(res.headers['access-control-allow-methods']).toContain('POST')
  })
})

describe('optimistic concurrency (opt-in)', () => {
  it('rejects a stale PUT with 409 when enabled; allows same/newer', async () => {
    const app = buildApp(openDb(':memory:'), { optimisticConcurrency: true })
    await post(app, 'accounts', account('a1'))
    // Store a client at T2.
    await put(app, 'clients', 'c1', { ...client('c1', 'a1'), updatedAt: '2026-02-02T00:00:00.000Z' })
    // A PUT carrying an OLDER updatedAt (T1) is a stale overwrite → 409.
    const stale = await put(app, 'clients', 'c1', { ...client('c1', 'a1'), name: 'Stale', updatedAt: '2026-02-01T00:00:00.000Z' })
    expect(stale.statusCode).toBe(409)
    expect((await state(app)).clients[0].name).toBe('Acme') // not overwritten
    // A PUT at a newer time succeeds.
    const fresh = await put(app, 'clients', 'c1', { ...client('c1', 'a1'), name: 'Fresh', updatedAt: '2026-02-03T00:00:00.000Z' })
    expect(fresh.statusCode).toBe(200)
    expect((await state(app)).clients[0].name).toBe('Fresh')
  })

  it('is OFF by default: last-writer-wins, no 409', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', account('a1'))
    await put(app, 'clients', 'c1', { ...client('c1', 'a1'), updatedAt: '2026-02-02T00:00:00.000Z' })
    const stale = await put(app, 'clients', 'c1', { ...client('c1', 'a1'), name: 'Stale', updatedAt: '2026-02-01T00:00:00.000Z' })
    expect(stale.statusCode).toBe(200)
    expect((await state(app)).clients[0].name).toBe('Stale')
  })
})

describe('null-id rejection (POST/batch without id → 400)', () => {
  it('POST without an id is rejected with 400', async () => {
    const { app } = freshApp()
    const res = await post(app, 'accounts', { name: 'No Id', color: '#3b82f6', ...meta() })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/id/)
    // nothing persisted
    expect((await state(app)).accounts).toHaveLength(0)
  })

  it('POST with id: null is rejected with 400', async () => {
    const { app } = freshApp()
    const res = await post(app, 'accounts', { id: null, name: 'Null Id', color: '#3b82f6', ...meta() })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/id/)
  })

  it('POST with empty-string id is rejected with 400', async () => {
    const { app } = freshApp()
    const res = await post(app, 'accounts', { id: '', name: 'Empty Id', color: '#3b82f6', ...meta() })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/id/)
  })

  it('batch PUT op with a missing/non-string id is rejected with 400', async () => {
    const { app } = freshApp()
    // A batch op whose id field is not a string — the batch handler rejects it before
    // it can reach sanitizeWrite (typeof id !== 'string' check).
    const res = await call(app, {
      method: 'POST',
      url: '/api/batch',
      payload: body({ ops: [{ method: 'PUT', table: 'accounts', row: { name: 'No Id', color: '#3b82f6', ...meta() } }] }),
    })
    expect(res.statusCode).toBe(400)
    expect((await state(app)).accounts).toHaveLength(0)
  })
})

describe('full-fixture round-trip (every optional field set; catches column-spec gaps)', () => {
  // Seed the fixture account + dependency chain, then write each entity via POST and
  // GET it back via /api/state. Deep-equal catches any column that is present in the
  // spec but not round-tripping correctly (NULL/optional handling, JSON encode/decode).
  async function seedFixtureDeps(app: FastifyInstance) {
    expect((await post(app, 'accounts', FIXTURE_ACCOUNT)).statusCode).toBe(201)
    expect((await post(app, 'clients', FIXTURE_CLIENT)).statusCode).toBe(201)
    expect((await post(app, 'disciplines', FIXTURE_DISCIPLINE)).statusCode).toBe(201)
    expect((await post(app, 'projects', FIXTURE_PROJECT)).statusCode).toBe(201)
    expect((await post(app, 'phases', FIXTURE_PHASE)).statusCode).toBe(201)
  }

  it('account: every field round-trips (including optional schedulingMode)', async () => {
    const { app } = freshApp()
    expect((await post(app, 'accounts', FIXTURE_ACCOUNT)).statusCode).toBe(201)
    expect((await state(app)).accounts[0]).toEqual(FIXTURE_ACCOUNT)
  })

  it('client: every field round-trips', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', FIXTURE_ACCOUNT)
    expect((await post(app, 'clients', FIXTURE_CLIENT)).statusCode).toBe(201)
    expect((await state(app)).clients[0]).toEqual(FIXTURE_CLIENT)
  })

  it('discipline: every field round-trips (including optional color)', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', FIXTURE_ACCOUNT)
    expect((await post(app, 'disciplines', FIXTURE_DISCIPLINE)).statusCode).toBe(201)
    expect((await state(app)).disciplines[0]).toEqual(FIXTURE_DISCIPLINE)
  })

  it('project: every field round-trips', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', FIXTURE_ACCOUNT)
    await post(app, 'clients', FIXTURE_CLIENT)
    expect((await post(app, 'projects', FIXTURE_PROJECT)).statusCode).toBe(201)
    expect((await state(app)).projects[0]).toEqual(FIXTURE_PROJECT)
  })

  it('phase: every field round-trips', async () => {
    const { app } = freshApp()
    await post(app, 'accounts', FIXTURE_ACCOUNT)
    await post(app, 'clients', FIXTURE_CLIENT)
    await post(app, 'projects', FIXTURE_PROJECT)
    expect((await post(app, 'phases', FIXTURE_PHASE)).statusCode).toBe(201)
    expect((await state(app)).phases[0]).toEqual(FIXTURE_PHASE)
  })

  it('resource: every field round-trips (including optional name/disciplineId/projectId + json workingDays)', async () => {
    const { app } = freshApp()
    await seedFixtureDeps(app)
    expect((await post(app, 'resources', FIXTURE_RESOURCE)).statusCode).toBe(201)
    expect((await state(app)).resources[0]).toEqual(FIXTURE_RESOURCE)
  })

  it('external resource: kind + company name round-trip (no discipline/project binding)', async () => {
    const { app } = freshApp()
    await seedFixtureDeps(app)
    expect((await post(app, 'resources', FIXTURE_RESOURCE_EXTERNAL)).statusCode).toBe(201)
    expect((await state(app)).resources[0]).toEqual(FIXTURE_RESOURCE_EXTERNAL)
  })

  it('task: every field round-trips (including optional projectId/phaseId)', async () => {
    const { app } = freshApp()
    await seedFixtureDeps(app)
    expect((await post(app, 'tasks', FIXTURE_TASK)).statusCode).toBe(201)
    expect((await state(app)).tasks[0]).toEqual(FIXTURE_TASK)
  })

  it('allocation: every field round-trips (including optional note + json ignoreWeekends + hoursPerDay 0)', async () => {
    const { app } = freshApp()
    await seedFixtureDeps(app)
    await post(app, 'resources', FIXTURE_RESOURCE)
    await post(app, 'tasks', FIXTURE_TASK)
    expect((await post(app, 'allocations', FIXTURE_ALLOCATION)).statusCode).toBe(201)
    expect((await state(app)).allocations[0]).toEqual(FIXTURE_ALLOCATION)
  })

  it('timeOff: every field round-trips (including optional note)', async () => {
    const { app } = freshApp()
    await seedFixtureDeps(app)
    await post(app, 'resources', FIXTURE_RESOURCE)
    expect((await post(app, 'timeOff', FIXTURE_TIMEOFF)).statusCode).toBe(201)
    expect((await state(app)).timeOff[0]).toEqual(FIXTURE_TIMEOFF)
  })
})
