import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import type { AccountAuditEvent } from '@capacitylens/shared/account/audit'
import { buildApp } from './app'
import { openDb } from './db'
import {
  compositeAuditSink,
  fileAuditSink,
  noopAuditSink,
  parseAuditConfig,
  streamAuditSink,
  type AuditRecord,
  type AuditSink,
} from './audit'

// P1.15 (flag CAPACITYLENS_AUDIT → opts.audit): an append-only JSONL line per AppData mutation,
// {ts,userId,accountId,action,entity,id,changedFields}. THE #1 INVARIANT proven here: changedFields
// are field NAMES only — a tenant VALUE (a time-off note, a name) NEVER reaches a line. Plus the
// fail-never contract (append never throws; the request still 2xx; a uniform warning header; deep-
// health latches degraded; ONE redacted error line) and the default-deploy byte-identity (noop sink
// → no file, no warning header).

const TS = '2026-01-01T00:00:00.000Z'
const meta = () => ({ createdAt: TS, updatedAt: TS })
const account = (id: string) => ({ id, name: 'Studio', color: '#5c34d4', ...meta() })
const client = (id: string, accountId: string) => ({ id, accountId, name: 'Acme', color: '#5c34d4', ...meta() })
const project = (id: string, accountId: string, clientId: string) => ({ id, accountId, name: 'Web', clientId, color: '#5c34d4', ...meta() })
const person = (id: string, accountId: string) => ({
  id,
  accountId,
  kind: 'person',
  role: 'Designer',
  employmentType: 'permanent',
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  color: '#5c34d4',
  ...meta(),
})
const timeOff = (id: string, accountId: string, resourceId: string, o: Record<string, unknown> = {}) => ({
  id,
  accountId,
  resourceId,
  startDate: '2026-03-01',
  endDate: '2026-03-05',
  type: 'sick',
  ...meta(),
  ...o,
})

const call = (app: FastifyInstance, opts: InjectOptions): Promise<LightMyRequestResponse> =>
  app.inject(opts) as unknown as Promise<LightMyRequestResponse>
const body = (payload: unknown) => payload as InjectOptions['payload']
const post = (app: FastifyInstance, entity: string, payload: unknown) =>
  call(app, { method: 'POST', url: `/api/${entity}`, payload: body(payload) })

/** A real file-backed app: a temp JSONL the assertions read line-by-line. */
function fileApp(): { app: FastifyInstance; file: string; lines: () => AuditRecord[]; log: ReturnType<typeof vi.fn> } {
  const dir = mkdtempSync(join(tmpdir(), 'capacitylens-audit-test-'))
  const file = join(dir, 'audit.jsonl')
  const log = vi.fn()
  const app = buildApp(openDb(':memory:'), { allowReset: true, optimisticConcurrency: false, audit: fileAuditSink(file, log) })
  const lines = () =>
    existsSync(file)
      ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as AuditRecord)
      : []
  return { app, file, lines, log }
}

/** Scaffold the minimal account→client→project→person chain so a timeOff write is FK-clean. */
async function scaffold(app: FastifyInstance) {
  await post(app, 'accounts', account('a1'))
  await post(app, 'clients', client('c1', 'a1'))
  await post(app, 'projects', project('p1', 'a1', 'c1'))
  await post(app, 'resources', person('r1', 'a1'))
}

afterEach(() => vi.restoreAllMocks())

describe('AuditRecord shape (1)', () => {
  it('POST writes normalized account correlation plus the compatible product mutation record', async () => {
    const { app, lines } = fileApp()
    const res = await post(app, 'accounts', account('a1'))
    expect(res.statusCode).toBe(201)
    const recs = lines()
    expect(recs).toHaveLength(2)
    const accountEvent = recs.find(
      (record) => (record as { action: string }).action === 'workspace.provisioned',
    ) as unknown as AccountAuditEvent
    expect(accountEvent).toMatchObject({
      applicationId: 'capacitylens',
      workspaceId: 'a1',
      actorPrincipalId: 'demo',
      targetPrincipalId: 'demo',
      action: 'workspace.provisioned',
      outcome: 'success',
      changedFields: ['workspace', 'membership'],
    })
    const rec = recs.find((record) => record.action === 'create')!
    expect(rec.action).toBe('create')
    expect(rec.entity).toBe('accounts')
    expect(rec.id).toBe('a1')
    expect(rec.accountId).toBe('a1')
    expect(rec.userId).toBe('demo') // DEMO_USER in OFF mode
    expect(typeof rec.ts).toBe('string')
    expect(Date.parse(rec.ts)).not.toBeNaN()
    // changedFields = the row's field NAMES (sanitized row keys), not values.
    expect(rec.changedFields).toEqual(expect.arrayContaining(['id', 'name', 'color', 'createdAt', 'updatedAt']))
  })

  it('creates the audit trail with owner-only permissions', async () => {
    const { app, file } = fileApp()
    expect((await post(app, 'accounts', account('a1'))).statusCode).toBe(201)
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })
})

describe('idempotent control-plane audit semantics', () => {
  it('does not append inviteRevoke for an already-absent invite', async () => {
    const { app, lines } = fileApp()
    expect((await post(app, 'accounts', account('a1'))).statusCode).toBe(201)
    const before = lines().length
    const res = await call(app, { method: 'DELETE', url: '/api/accounts/a1/invites/missing' })
    expect(res.statusCode).toBe(204)
    expect(lines().slice(before).filter((record) => record.action === 'inviteRevoke')).toHaveLength(0)
  })

  it('does not append a second mutation event when an invitation command is replayed', async () => {
    const { app, lines } = fileApp()
    expect((await post(app, 'accounts', account('a1'))).statusCode).toBe(201)
    const request: InjectOptions = {
      method: 'POST',
      url: '/api/invites',
      headers: {
        'idempotency-key': 'audit-idempotency-0001',
        'x-account-command-id': 'audit-command-0000001',
      },
      payload: { accountId: 'a1', role: 'viewer' },
    }

    expect((await call(app, request)).statusCode).toBe(201)
    expect((await call(app, request)).statusCode).toBe(201)

    expect(lines().filter((record) => record.action === 'inviteCreate')).toHaveLength(1)
    expect(lines().filter(
      (record) => (record as unknown as { action: string }).action === 'invitation.created',
    )).toHaveLength(1)
  })
})

describe('NO PII (2) — the #1 invariant', () => {
  it('a timeOff note logs the field NAME but never the value', async () => {
    const { app, file, lines } = fileApp()
    await scaffold(app)
    const createIdx = lines().length // the timeOff create line lands here (after the scaffold lines)
    const SECRET = 'SECRET_NOTE_TEXT'
    // create with a secret note
    expect((await post(app, 'timeOff', timeOff('to1', 'a1', 'r1', { note: SECRET }))).statusCode).toBe(201)
    // update it (PUT) with a different secret note
    const SECRET2 = 'ANOTHER_SECRET_VALUE'
    const put = await call(app, {
      method: 'PUT',
      url: '/api/timeOff/to1',
      payload: body(timeOff('to1', 'a1', 'r1', { note: SECRET2 })),
    })
    expect(put.statusCode).toBe(200)

    const raw = readFileSync(file, 'utf8')
    // The NAME is present...
    expect(raw).toContain('note')
    // ...but NO secret VALUE substring, on either line.
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain(SECRET2)
    // Belt-and-braces: no other field VALUE leaks — the only string values that COULD appear are
    // the structural ids/dates we intend (a1/to1/r1/the date). Assert the human-typed value class
    // (the note, the resource role 'Designer') is absent.
    expect(raw).not.toContain('Designer')
    // And changedFields on the timeOff CREATE line really is just names.
    const recs = lines()
    expect(recs[createIdx].entity).toBe('timeOff')
    expect(recs[createIdx].changedFields).toContain('note')
    expect(recs[createIdx].changedFields).not.toContain(SECRET)
  })
})

describe('NO resource PII in the audit log (2b) — P2.3 acceptance', () => {
  it("a resource's name VALUE never reaches the audit file, but 'name' IS in changedFields", async () => {
    const { app, file, lines } = fileApp()
    // A name unique enough to grep for unambiguously across the whole raw file.
    const SENTINEL = 'ZZSENTINELPERSON_DELETE_ME'
    await post(app, 'accounts', account('a1')) // FK parent for the resource
    const createIdx = lines().length // the resource create line lands here
    // Create an audited resource carrying the sentinel as its NAME (the only resource PII today).
    expect((await post(app, 'resources', { ...person('r1', 'a1'), name: SENTINEL })).statusCode).toBe(201)
    // A second audited mutation (a non-PII PATCH) so there's more than one line to scan.
    const patch = await call(app, { method: 'PATCH', url: '/api/resources/r1', payload: body({ role: 'Lead Designer' }) })
    expect(patch.statusCode).toBe(200)

    // The RAW audit JSONL must NEVER contain the name VALUE — on any line.
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain(SENTINEL)

    // ...yet the create line DID capture the field — 'name' is recorded as a changedFields KEY (the
    // name of the field, never its value): the audit saw the create and stored only the key.
    const rec = lines()[createIdx]
    expect(rec.entity).toBe('resources')
    expect(rec.id).toBe('r1')
    expect(rec.changedFields).toContain('name')
    expect(rec.changedFields).not.toContain(SENTINEL)
  })
})

describe('PATCH changedFields = exactly the body keys (3)', () => {
  it('records the PATCH req.body keys, NOT the merged row', async () => {
    const { app, lines } = fileApp()
    await scaffold(app)
    const before = lines().length
    const res = await call(app, { method: 'PATCH', url: '/api/resources/r1', payload: body({ role: 'Lead Designer' }) })
    expect(res.statusCode).toBe(200)
    const rec = lines()[before]
    expect(rec.action).toBe('patch')
    expect(rec.changedFields).toEqual(['role']) // exactly the body keys, not the merged columns
  })
})

describe('parseAuditConfig + default deploy (4)', () => {
  it('is ON by default and OFF only on =off', () => {
    expect(parseAuditConfig({}, '/data/capacitylens.db').enabled).toBe(true)
    expect(parseAuditConfig({ CAPACITYLENS_AUDIT: 'anything' }, '/data/capacitylens.db').enabled).toBe(true)
    expect(parseAuditConfig({ CAPACITYLENS_AUDIT: 'off' }, '/data/capacitylens.db').enabled).toBe(false)
  })

  it('defaults the file beside the DB; :memory: falls back to CWD-relative; env overrides', () => {
    expect(parseAuditConfig({}, '/data/capacitylens.db').file).toBe('/data/capacitylens-audit.jsonl')
    expect(parseAuditConfig({}, ':memory:').file).toBe('capacitylens-audit.jsonl')
    expect(parseAuditConfig({ CAPACITYLENS_AUDIT_FILE: '/var/x.jsonl' }, '/data/db').file).toBe('/var/x.jsonl')
  })

  it('factory with NO opts.audit (noop) writes no file and sets no warning header', async () => {
    const app = buildApp(openDb(':memory:'), { allowReset: true }) // no audit → noopAuditSink()
    const res = await post(app, 'accounts', account('a1'))
    expect(res.statusCode).toBe(201)
    expect(res.headers['x-capacitylens-audit-warning']).toBeUndefined()
  })
})

describe('failure contract (5)', () => {
  /** A sink whose append always fails — proves the fail-never + warning + degraded contract. */
  function brokenSink(): AuditSink {
    let degraded = false
    return {
      append() {
        degraded = true
        return false
      },
      get degraded() {
        return degraded
      },
    }
  }

  it('still 2xx, sets the warning header, latches deep-health degraded', async () => {
    const sink = brokenSink()
    const app = buildApp(openDb(':memory:'), { allowReset: true, healthDeep: true, audit: sink })
    const res = await post(app, 'accounts', account('a1'))
    expect(res.statusCode).toBe(201) // the mutation committed; audit failure never blocks it
    expect(res.headers['x-capacitylens-audit-warning']).toBe('true')

    const health = await call(app, { method: 'GET', url: '/api/health' })
    expect(health.statusCode).toBe(200) // ok:true — audit-degraded is a SOFT signal
    expect(health.json()).toEqual({ ok: true, db: true, audit: 'degraded' })
  })

  it('append never throws and logs EXACTLY ONE redacted (no-PII) error line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'capacitylens-audit-fail-'))
    // A directory path used as a FILE → appendFileSync throws → the sink catches it.
    const log = vi.fn()
    const sink = fileAuditSink(dir, log) // dir is a directory, not a file
    expect(() => sink.append({ ts: TS, userId: 'demo', accountId: 'a1', action: 'create', entity: 'accounts', id: 'a1', changedFields: ['note'] })).not.toThrow()
    expect(sink.append({ ts: TS, userId: 'demo', accountId: 'a1', action: 'create', entity: 'accounts', id: 'a2', changedFields: ['note'] })).toBe(false)
    expect(sink.degraded).toBe(true)
    expect(log).toHaveBeenCalledTimes(1) // loggedOnce guard — no spam
    const msg = log.mock.calls[0][0] as string
    expect(msg).toContain('audit write FAILED')
    expect(msg).not.toContain('note') // message-only — never the record
    expect(msg).not.toContain('a1')
    expect(msg).not.toContain('a2')
  })
})

describe('batch → one line per op (6)', () => {
  it('logs one audit line for each committed op', async () => {
    const { app, lines } = fileApp()
    await scaffold(app)
    const before = lines().length
    const res = await call(app, {
      method: 'POST',
      url: '/api/batch',
      payload: body({
        ops: [
          { method: 'PUT', table: 'disciplines', id: 'd2', row: { id: 'd2', accountId: 'a1', name: 'Design', color: '#5c34d4', sortOrder: 0, ...meta() } },
          { method: 'DELETE', table: 'disciplines', id: 'd2', accountId: 'a1' },
        ],
      }),
    })
    expect(res.statusCode).toBe(200)
    const fresh = lines().slice(before)
    expect(fresh).toHaveLength(2)
    expect(fresh[0]).toMatchObject({ action: 'create', entity: 'disciplines', id: 'd2' })
    expect(fresh[0].changedFields).toContain('name')
    expect(fresh[1]).toMatchObject({ action: 'delete', entity: 'disciplines', id: 'd2', changedFields: [] })
  })
})

describe('import → one import line (7)', () => {
  it('logs a single import record with changedFields = []', async () => {
    const { app, lines } = fileApp()
    await post(app, 'accounts', account('a1'))
    const before = lines().length
    const file = {
      schemaVersion: 3,
      data: {
        accounts: [],
        clients: [client('ic1', 'x')],
        disciplines: [],
        projects: [],
        phases: [],
        resources: [],
        activities: [],
        allocations: [],
        timeOff: [],
      },
    }
    const res = await call(app, { method: 'POST', url: '/api/import', payload: body({ accountId: 'a1', data: file }) })
    expect(res.statusCode).toBe(200)
    const fresh = lines().slice(before)
    expect(fresh).toHaveLength(1)
    expect(fresh[0]).toMatchObject({ action: 'import', entity: 'account', id: 'a1', accountId: 'a1', changedFields: [] })
  })

  it('a REFUSED zero-record import writes NO audit line (nothing was replaced — no false record)', async () => {
    const { app, lines } = fileApp()
    await post(app, 'accounts', account('a1'))
    const before = lines().length
    // Every record drops in remap (an allocation with dangling refs) → imported = 0 → the server
    // refuses the replace and returns 200 {imported: 0}; the audit must not claim an import ran.
    const file = {
      schemaVersion: 3,
      data: {
        accounts: [],
        clients: [],
        disciplines: [],
        projects: [],
        phases: [],
        resources: [],
        activities: [],
        allocations: [
          { id: 'dangling', accountId: 'x', resourceId: 'nope', activityId: 'nope', startDate: '2026-01-05', endDate: '2026-01-09', hoursPerDay: 4, createdAt: 't', updatedAt: 't' },
        ],
        timeOff: [],
      },
    }
    const res = await call(app, { method: 'POST', url: '/api/import', payload: body({ accountId: 'a1', data: file }) })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { imported: number }).imported).toBe(0)
    expect(lines().slice(before)).toHaveLength(0)
  })
})

describe('rolled-back batch → ZERO new audit lines (8) — proves post-commit', () => {
  it('a constraint-violating batch is 400 and writes NO audit line', async () => {
    const { app, lines } = fileApp()
    await scaffold(app)
    const before = lines().length
    // A project referencing a non-existent client → FK constraint failure → tx rolls back → 400.
    const res = await call(app, {
      method: 'POST',
      url: '/api/batch',
      payload: body({
        ops: [{ method: 'PUT', table: 'projects', id: 'p9', row: project('p9', 'a1', 'ghost-client') }],
      }),
    })
    expect(res.statusCode).toBe(400)
    expect(lines().slice(before)).toHaveLength(0) // the loop runs AFTER the tx commits — none ran
  })
})

describe('noopAuditSink', () => {
  it('append always succeeds and degraded is always false', () => {
    const sink = noopAuditSink()
    expect(sink.append({ ts: TS, userId: 'demo', accountId: 'a1', action: 'create', entity: 'accounts', id: 'a1', changedFields: [] })).toBe(true)
    expect(sink.degraded).toBe(false)
  })
})

describe('central audit forwarding', () => {
  const record: AuditRecord = {
    ts: TS,
    userId: 'user-1',
    accountId: 'account-1',
    action: 'sessionsRevoke',
    entity: 'identity',
    id: 'user-2',
    changedFields: ['sessions'],
  }

  it('emits a typed one-line JSON envelope suitable for an external collector', () => {
    const lines: string[] = []
    const sink = streamAuditSink((line) => lines.push(line))
    expect(sink.append(record)).toBe(true)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual({ type: 'capacitylens.audit', ...record })
    expect(lines[0]).not.toContain('\n')
    expect(sink.degraded).toBe(false)
  })

  it('latches a stream failure and makes a composite destination fail closed visibly', () => {
    const healthy = noopAuditSink()
    const failed = streamAuditSink(() => { throw new Error('collector unavailable') })
    const composite = compositeAuditSink(healthy, failed)
    expect(() => composite.append(record)).not.toThrow()
    expect(composite.append(record)).toBe(false)
    expect(composite.degraded).toBe(true)
  })
})

describe('size-based rotation (9) — bounds on-disk usage to ~2x maxBytes', () => {
  const rec = (id: string): AuditRecord => ({
    ts: TS,
    userId: 'demo',
    accountId: 'a1',
    action: 'create',
    entity: 'accounts',
    id,
    changedFields: ['name'],
  })

  it('rotates the PREVIOUS generation into .1 once the file reaches maxBytes, and keeps appending to a fresh file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capacitylens-audit-rotate-'))
    const file = join(dir, 'audit.jsonl')
    const log = vi.fn()
    // maxBytes pinned to the size of exactly one line (every id here is 2 chars, so every line is
    // the same length) — the SECOND append is therefore always the one that finds the cap reached.
    const lineBytes = Buffer.byteLength(JSON.stringify(rec('r1')) + '\n', 'utf8')
    const sink = fileAuditSink(file, log, { maxBytes: lineBytes })

    expect(sink.append(rec('r1'))).toBe(true) // file didn't exist (size 0 < cap) — no rotation
    expect(existsSync(`${file}.1`)).toBe(false)

    expect(sink.append(rec('r2'))).toBe(true) // size(file) === cap → rotate before writing
    expect(readFileSync(`${file}.1`, 'utf8')).toBe(JSON.stringify(rec('r1')) + '\n')
    expect(readFileSync(file, 'utf8')).toBe(JSON.stringify(rec('r2')) + '\n')

    // The fresh file is now ALSO at the cap, so a third append rotates again — proving appends
    // keep landing in a genuinely fresh file each cycle, not erroring or wedging on a second rotation.
    expect(sink.append(rec('r3'))).toBe(true)
    expect(readFileSync(`${file}.1`, 'utf8')).toBe(JSON.stringify(rec('r2')) + '\n')
    expect(readFileSync(file, 'utf8')).toBe(JSON.stringify(rec('r3')) + '\n')
    expect(log).not.toHaveBeenCalled()
    expect(sink.degraded).toBe(false)
  })

  it('replaces a pre-existing .1 that predates this sink (not merged, not appended to)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capacitylens-audit-rotate-'))
    const file = join(dir, 'audit.jsonl')
    writeFileSync(`${file}.1`, 'STALE_UNRELATED_CONTENT_FROM_A_PRIOR_GENERATION')
    const log = vi.fn()
    const lineBytes = Buffer.byteLength(JSON.stringify(rec('r1')) + '\n', 'utf8')
    const sink = fileAuditSink(file, log, { maxBytes: lineBytes })

    sink.append(rec('r1'))
    sink.append(rec('r2')) // triggers the rotation
    const rotated = readFileSync(`${file}.1`, 'utf8')
    expect(rotated).not.toContain('STALE_UNRELATED_CONTENT_FROM_A_PRIOR_GENERATION')
    expect(rotated).toBe(JSON.stringify(rec('r1')) + '\n')
  })

  it('defaults maxBytes to 64 MiB — an ordinary run of appends never rotates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capacitylens-audit-rotate-'))
    const file = join(dir, 'audit.jsonl')
    const sink = fileAuditSink(file, vi.fn()) // no opts — default applies
    for (let i = 0; i < 50; i++) sink.append(rec(`r${i}`))
    expect(existsSync(`${file}.1`)).toBe(false)
  })

  it('a rename failure (rotation) degrades the sink instead of throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capacitylens-audit-rotate-fail-'))
    const file = join(dir, 'audit.jsonl')
    const log = vi.fn()
    const lineBytes = Buffer.byteLength(JSON.stringify(rec('r1')) + '\n', 'utf8')
    const sink = fileAuditSink(file, log, { maxBytes: lineBytes })
    expect(sink.append(rec('r1'))).toBe(true) // creates the file, under cap

    // Pre-create a DIRECTORY at the rotation destination, so renameSync(file, `${file}.1`) fails
    // with EISDIR (you cannot rename a file onto an existing directory) — a REAL fs failure, the
    // same "no mocking" style the append-failure test above uses (directory-as-file for appendFileSync).
    mkdirSync(`${file}.1`)

    expect(() => sink.append(rec('r2'))).not.toThrow()
    expect(sink.append(rec('r2'))).toBe(false)
    expect(sink.degraded).toBe(true)
    expect(log).toHaveBeenCalledTimes(1) // loggedOnce guard — no spam across repeated failures
    const msg = log.mock.calls[0][0] as string
    expect(msg).toContain('audit write FAILED')
  })
})
