import { describe, it, expect } from 'vitest'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import { buildApp } from './app'
import { openDb } from './db'

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
const del = (app: FastifyInstance, entity: string, id: string) =>
  call(app, { method: 'DELETE', url: `/api/${entity}/${id}` })
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
    expect((await del(app, 'clients', 'c1')).statusCode).toBe(204)
    expect((await state(app)).clients).toHaveLength(0)
  })

  it('PATCH on a missing id is 404; unknown entity is 404', async () => {
    const { app } = freshApp()
    await scaffold(app)
    expect((await patch(app, 'clients', 'nope', client('nope', 'a1'))).statusCode).toBe(404)
    expect((await post(app, 'widgets', { id: 'x' })).statusCode).toBe(404)
  })

  it('DELETE is idempotent (missing id still 204)', async () => {
    const { app } = freshApp()
    expect((await del(app, 'clients', 'ghost')).statusCode).toBe(204)
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
    await del(app, 'clients', 'c1')
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
    await del(app, 'disciplines', 'd1')
    const s = await state(app)
    expect(s.disciplines).toHaveLength(0)
    expect(s.resources).toHaveLength(1)
    expect(s.resources[0].disciplineId).toBeUndefined()
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
