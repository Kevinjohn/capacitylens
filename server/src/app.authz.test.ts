import { describe, it, expect } from 'vitest'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { buildApp } from './app'
import { openDb, insertAll, type Db } from './db'
import { upsertMember } from './controlTables'
import { authFromEnv, runAuthMigrations } from './auth'
import { PASSWORD_ENV, call, signUp } from './testHelpers'
import { can, type Role } from '@capacitylens/shared/domain/access'
import { emptyAppData, type AppData } from '@capacitylens/shared/types/entities'

// P1.5 requirePermission — the auth-on 403 matrix for the authorize() route gate, plus the #1
// invariant that OFF mode stays allow-all/no-op (cross-account ids included). The gate maps each
// protected route onto a pure can(role, action) decision against the caller's membership role; this
// suite drives those routes end-to-end (sign-up → membership → request) and asserts the resulting
// 2xx/403, NOT the matrix in isolation (access.test.ts owns the matrix unit).

const TS = '2026-01-01T00:00:00.000Z'
const meta = () => ({ createdAt: TS, updatedAt: TS })

const account = (id: string) => ({ id, name: `Studio ${id}`, color: '#3b82f6', ...meta() })
const client = (id: string, accountId: string) => ({ id, accountId, name: 'Acme', color: '#3b82f6', ...meta() })
const project = (id: string, accountId: string, clientId: string) => ({ id, accountId, name: 'Web', clientId, color: '#3b82f6', ...meta() })
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
const timeOff = (id: string, accountId: string, resourceId: string, note?: string) => ({
  id,
  accountId,
  resourceId,
  startDate: '2026-02-01',
  endDate: '2026-02-03',
  type: 'vacation',
  ...(note !== undefined ? { note } : {}),
  ...meta(),
})

// P1.6: a recognizable sentinel for a1's time-off note. Asserting it is ABSENT from the raw response
// BODY (not just the parsed key) is what proves the redaction is SERVER-SIDE — the note never serialized.
const SENTINEL_TIMEOFF_NOTE = 'SENTINEL_TIMEOFF_NOTE'

/**
 * Two accounts a1/a2, seeded directly via insertAll (parent-first). a1 additionally carries a
 * resource + a time-off row whose `note` is {@link SENTINEL_TIMEOFF_NOTE}, so the P1.6 redaction
 * suite can assert owner/admin SEE it and editor/viewer do NOT.
 */
function seedTwo(db: Db): void {
  const d = emptyAppData() as unknown as Record<string, unknown[]>
  d.accounts = [account('a1'), account('a2')]
  d.clients = [client('c1', 'a1'), client('c2', 'a2')]
  d.projects = [project('p1', 'a1', 'c1'), project('p2', 'a2', 'c2')]
  d.resources = [person('r1', 'a1')]
  d.timeOff = [timeOff('to1', 'a1', 'r1', SENTINEL_TIMEOFF_NOTE)]
  insertAll(db, d as unknown as AppData)
}

/** Build an auth-on (password) app over a fresh in-memory DB, returning both so the test can seed.
 *  `multiAccount` defaults to the single-company-cap OFF default (false) — pass `true` for a test
 *  that deliberately exercises a multi-company instance. */
async function appWithAuth(
  opts: { multiAccount?: boolean; optimisticConcurrency?: boolean } = {},
): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(':memory:')
  const { mode, auth } = authFromEnv(db, PASSWORD_ENV)
  await runAuthMigrations(auth!)
  return {
    app: buildApp(db, {
      authMode: mode,
      auth,
      multiAccount: opts.multiAccount,
      optimisticConcurrency: opts.optimisticConcurrency,
    }),
    db,
  }
}

// ---- Per-verb requests against a1's seeded rows (cookie carries the session in auth-on). ----
// Each returns the status of ONE write/read so a test can assert allow (2xx) vs deny (403).

const getState = (app: FastifyInstance, accountId: string, cookie?: string) =>
  call(app, { method: 'GET', url: `/api/state?accountId=${accountId}`, headers: cookie ? { cookie } : {} })

/** POST a NEW client into `accountId`. */
const postClient = (app: FastifyInstance, accountId: string, id: string, cookie?: string) =>
  call(app, { method: 'POST', url: '/api/clients', payload: client(id, accountId), headers: cookie ? { cookie } : {} })

/** PUT (upsert) a client by id into `accountId`. */
const putClient = (app: FastifyInstance, accountId: string, id: string, cookie?: string) =>
  call(app, { method: 'PUT', url: `/api/clients/${id}`, payload: client(id, accountId), headers: cookie ? { cookie } : {} })

/** PATCH the seeded client c1/c2 (no accountId in the body — it merges from the stored row). */
const patchClient = (app: FastifyInstance, id: string, cookie?: string) =>
  call(app, { method: 'PATCH', url: `/api/clients/${id}`, payload: { name: 'Renamed' }, headers: cookie ? { cookie } : {} })

/** DELETE the seeded project p1/p2 (scoped delete needs ?accountId=). */
const deleteProject = (app: FastifyInstance, accountId: string, id: string, cookie?: string) =>
  call(app, { method: 'DELETE', url: `/api/projects/${id}?accountId=${accountId}`, headers: cookie ? { cookie } : {} })

/** A batch that upserts a NEW client into `accountId`. */
const batchInto = (app: FastifyInstance, accountId: string, id: string, cookie?: string) =>
  call(app, {
    method: 'POST',
    url: '/api/batch',
    payload: { ops: [{ method: 'PUT', table: 'clients', id, row: client(id, accountId) }] },
    headers: cookie ? { cookie } : {},
  })

/** Import a single-client slice into `accountId`. */
const importInto = (app: FastifyInstance, accountId: string, id: string, cookie?: string) => {
  const data = { ...emptyAppData(), clients: [client(id, accountId)] }
  return call(app, { method: 'POST', url: '/api/import', payload: { accountId, data }, headers: cookie ? { cookie } : {} })
}

describe('P1.5 authorize — auth-on 403 matrix', () => {
  it('non-member (signed in, no membership): every scoped read/write to a1 → 403', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const { cookie } = await signUp(app, 'stranger@capacitylens.dev') // NO membership upserted

    expect((await getState(app, 'a1', cookie)).statusCode).toBe(403)
    expect((await postClient(app, 'a1', 'nc1', cookie)).statusCode).toBe(403)
    expect((await putClient(app, 'a1', 'nc2', cookie)).statusCode).toBe(403)
    expect((await patchClient(app, 'c1', cookie)).statusCode).toBe(403)
    expect((await deleteProject(app, 'a1', 'p1', cookie)).statusCode).toBe(403)
    expect((await batchInto(app, 'a1', 'nc3', cookie)).statusCode).toBe(403)
    expect((await importInto(app, 'a1', 'nc4', cookie)).statusCode).toBe(403)
  })

  it('cross-account: a member of a1 only → any read/write targeting a2 → 403', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const { cookie, userId } = await signUp(app, 'a1member@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'editor', status: 'active', createdAt: TS })

    expect((await getState(app, 'a2', cookie)).statusCode).toBe(403)
    expect((await postClient(app, 'a2', 'x1', cookie)).statusCode).toBe(403)
    expect((await putClient(app, 'a2', 'x2', cookie)).statusCode).toBe(403)
    expect((await patchClient(app, 'c2', cookie)).statusCode).toBe(403) // c2 belongs to a2
    expect((await deleteProject(app, 'a2', 'p2', cookie)).statusCode).toBe(403)
    expect((await batchInto(app, 'a2', 'x3', cookie)).statusCode).toBe(403)
    expect((await importInto(app, 'a2', 'x4', cookie)).statusCode).toBe(403)
  })

  it('cross-account batch (one a1 op + one a2 op) → 403 AND the a1 op is NOT applied', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const { cookie, userId } = await signUp(app, 'mixed@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'editor', status: 'active', createdAt: TS })

    const res = await call(app, {
      method: 'POST',
      url: '/api/batch',
      payload: {
        ops: [
          { method: 'PUT', table: 'clients', id: 'mixA', row: client('mixA', 'a1') }, // allowed alone
          { method: 'PUT', table: 'clients', id: 'mixB', row: client('mixB', 'a2') }, // denied → rejects WHOLE
        ],
      },
      headers: { cookie },
    })
    expect(res.statusCode).toBe(403)

    // Pre-scan rejected the batch before the tx opened, so the a1 op left NO trace. Read a1 as a
    // member and confirm only the originally-seeded client c1 exists.
    const a1 = await getState(app, 'a1', cookie)
    expect(a1.statusCode).toBe(200)
    expect(a1.json().clients.map((c: { id: string }) => c.id).sort()).toEqual(['c1'])
  })

  it('viewer of a1: read → 200; any write to a1 → 403', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const { cookie, userId } = await signUp(app, 'viewer@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'viewer', status: 'active', createdAt: TS })

    expect((await getState(app, 'a1', cookie)).statusCode).toBe(200)
    expect((await postClient(app, 'a1', 'vc1', cookie)).statusCode).toBe(403)
    expect((await putClient(app, 'a1', 'vc2', cookie)).statusCode).toBe(403)
    expect((await patchClient(app, 'c1', cookie)).statusCode).toBe(403)
    expect((await deleteProject(app, 'a1', 'p1', cookie)).statusCode).toBe(403)
    expect((await batchInto(app, 'a1', 'vc3', cookie)).statusCode).toBe(403)
    expect((await importInto(app, 'a1', 'vc4', cookie)).statusCode).toBe(403)
  })

  it('editor of a1: read → 200; every row-level write to a1 → 2xx; import → 403 (purge tier)', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const { cookie, userId } = await signUp(app, 'editor@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'editor', status: 'active', createdAt: TS })

    expect((await getState(app, 'a1', cookie)).statusCode).toBe(200)
    expect((await postClient(app, 'a1', 'ec1', cookie)).statusCode).toBe(201)
    expect((await putClient(app, 'a1', 'ec2', cookie)).statusCode).toBe(200)
    expect((await patchClient(app, 'c1', cookie)).statusCode).toBe(200)
    expect((await deleteProject(app, 'a1', 'p1', cookie)).statusCode).toBe(204)
    expect((await batchInto(app, 'a1', 'ec3', cookie)).statusCode).toBe(200)
    // Import is NOT an editor write: it replaces the whole slice AND (all ids remapped) bypasses
    // the P1.6 note pin — gated 'purge' (admin+). See the dedicated import-tier suite below.
    expect((await importInto(app, 'a1', 'ec4', cookie)).statusCode).toBe(403)
  })

  it.each(['admin', 'owner'] as const)('%s of a1: writes to a1 → 2xx (tier ≥ editor)', async (role) => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const { cookie, userId } = await signUp(app, `${role}@capacitylens.dev`)
    upsertMember(db, { accountId: 'a1', userId, role, status: 'active', createdAt: TS })

    expect((await getState(app, 'a1', cookie)).statusCode).toBe(200)
    expect((await postClient(app, 'a1', `${role}-c1`, cookie)).statusCode).toBe(201)
    expect((await putClient(app, 'a1', `${role}-c2`, cookie)).statusCode).toBe(200)
    expect((await patchClient(app, 'c1', cookie)).statusCode).toBe(200)
    expect((await deleteProject(app, 'a1', 'p1', cookie)).statusCode).toBe(204)
    expect((await batchInto(app, 'a1', `${role}-c3`, cookie)).statusCode).toBe(200)
    expect((await importInto(app, 'a1', `${role}-c4`, cookie)).statusCode).toBe(200)
  })

  it('generic account create is CLOSED auth-on: POST /api/accounts → 403 directing to /api/orgs', async () => {
    const { app, db } = await appWithAuth()
    const { cookie } = await signUp(app, 'onboarding@capacitylens.dev') // no membership → no account yet
    const res = await call(app, {
      method: 'POST',
      url: '/api/accounts',
      payload: account('newAcct'),
      headers: { cookie },
    })
    // The old onboarding exemption (this POST used to 201 for a membership-less user) became an
    // authz bypass once POST /api/orgs landed: the bare row write never mints a membership (and
    // none is ever backfilled), so every generic auth-on create is now refused. Even the zero-
    // account first-run goes through /api/orgs, which handles it atomically.
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toContain('/api/orgs')
    expect((db.prepare(`SELECT COUNT(*) AS n FROM accounts`).get() as { n: number }).n).toBe(0)
    // …and /api/orgs DOES let the same user bootstrap their first company (201 + owner membership).
    const orgs = await call(app, { method: 'POST', url: '/api/orgs', payload: account('newAcct'), headers: { cookie } })
    expect(orgs.statusCode).toBe(201)
  })
})

describe('P1.6 time-off note redaction — owner/admin see it; editor/viewer never receive it', () => {
  // a1 carries a time-off row whose note === SENTINEL_TIMEOFF_NOTE (see seedTwo). The note is
  // owner/admin-only (canSeeTimeOffNote), redacted SERVER-SIDE in the scoped read. For editor/viewer
  // we assert BOTH the parsed `note` is absent AND the sentinel appears NOWHERE in the raw body — the
  // latter is what proves the redaction is server-side (the string was never serialized), not a
  // client-side hide.
  const noteOf = (res: LightMyRequestResponse): string | undefined =>
    (res.json().timeOff[0] as { note?: string }).note

  it.each(['owner', 'admin'] as const)('%s of a1: scoped read INCLUDES the note', async (role) => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const { cookie, userId } = await signUp(app, `${role}-note@capacitylens.dev`)
    upsertMember(db, { accountId: 'a1', userId, role, status: 'active', createdAt: TS })

    const res = await getState(app, 'a1', cookie)
    expect(res.statusCode).toBe(200)
    expect(noteOf(res)).toBe(SENTINEL_TIMEOFF_NOTE)
    expect(res.body).toContain(SENTINEL_TIMEOFF_NOTE)
  })

  it.each(['editor', 'viewer'] as const)('%s of a1: note ABSENT and sentinel not in the raw body', async (role) => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const { cookie, userId } = await signUp(app, `${role}-note@capacitylens.dev`)
    upsertMember(db, { accountId: 'a1', userId, role, status: 'active', createdAt: TS })

    const res = await getState(app, 'a1', cookie)
    expect(res.statusCode).toBe(200)
    expect(res.json().timeOff.length).toBe(1) // the row is returned…
    expect('note' in (res.json().timeOff[0] as object)).toBe(false) // …minus its note key
    expect(noteOf(res)).toBeUndefined()
    // The clincher: the sentinel was never serialized onto the wire (server-side redaction).
    expect(res.body).not.toContain(SENTINEL_TIMEOFF_NOTE)
  })

  it('OFF mode (trusted-local): scoped read INCLUDES the note', async () => {
    const db = openDb(':memory:')
    const app = buildApp(db) // no authMode ⇒ OFF
    seedTwo(db)
    const res = await getState(app, 'a1') // no cookie needed in OFF
    expect(res.statusCode).toBe(200)
    expect(noteOf(res)).toBe(SENTINEL_TIMEOFF_NOTE)
    expect(res.body).toContain(SENTINEL_TIMEOFF_NOTE)
  })
})

describe('P1.6 time-off note preservation on WRITE — a note-blind writer cannot erase a note', () => {
  // The write-side counterpart of the read redaction above. An editor's reads have the `note`
  // REDACTED, so every row they round-trip back (PUT / batch PUT — the client's real save paths)
  // is note-less by construction; without the sanitizeWrite pin, upsertRow would store NULL and
  // silently erase a note the editor never saw. Owner/admin (and OFF mode) writers keep full
  // control: they can still change or clear the note.

  const SENTINEL = SENTINEL_TIMEOFF_NOTE
  const stampedTimeOff = (over: Record<string, unknown> = {}) =>
    ({ ...timeOff('to1', 'a1', 'r1'), ...over }) as Record<string, unknown>

  /** The note as an OWNER sees it after the write under test (the ground truth in the DB). */
  const noteInDb = (db: Db): unknown =>
    (db.prepare(`SELECT note FROM timeOff WHERE id = 'to1'`).get() as { note: unknown }).note

  /** Auth-on app + seed + a signed-up member of a1 with `role`. */
  async function memberApp(role: Role, opts: { optimisticConcurrency?: boolean } = {}) {
    const { app, db } = await appWithAuth(opts)
    seedTwo(db)
    const { cookie, userId } = await signUp(app, `${role}-notewrite-${Math.random().toString(36).slice(2)}@capacitylens.dev`)
    upsertMember(db, { accountId: 'a1', userId, role, status: 'active', createdAt: TS })
    return { app, db, cookie }
  }

  it('editor PUT of a redacted round-trip (no note key, edited dates) → 200 and the note SURVIVES', async () => {
    const { app, db, cookie } = await memberApp('editor')
    const res = await call(app, {
      method: 'PUT',
      url: '/api/timeOff/to1',
      payload: stampedTimeOff({ endDate: '2026-02-05' }), // what the editor actually has: note-less
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(noteInDb(db)).toBe(SENTINEL) // pinned to the stored value, not NULLed
    // …and the write itself took effect (the pin is surgical, not a rejected write).
    expect((db.prepare(`SELECT endDate FROM timeOff WHERE id = 'to1'`).get() as { endDate: string }).endDate).toBe('2026-02-05')
    // The write's ECHO is a read: the pinned note must NOT ride the response back to the
    // note-blind writer (redactNoteEcho) — same server-side proof as the read-redaction suite.
    expect(res.body).not.toContain(SENTINEL)
  })

  it('editor batch PUT (the client sync path) → 200 and the note SURVIVES', async () => {
    const { app, db, cookie } = await memberApp('editor')
    const res = await call(app, {
      method: 'POST',
      url: '/api/batch',
      payload: { ops: [{ method: 'PUT', table: 'timeOff', id: 'to1', row: stampedTimeOff({ type: 'sick' }) }] },
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(noteInDb(db)).toBe(SENTINEL)
    expect((db.prepare(`SELECT type FROM timeOff WHERE id = 'to1'`).get() as { type: string }).type).toBe('sick')
  })

  it("editor STALE write (optimistic concurrency) → the 409's `current` payload is note-REDACTED too", async () => {
    // The conflict path is a READ of the stored row: without redaction, an editor could learn a
    // note they can't read simply by sending a stale write. Both write paths must redact it.
    const { app, cookie } = await memberApp('editor', { optimisticConcurrency: true })
    const stale = stampedTimeOff({ updatedAt: '1999-01-01T00:00:00.000Z' }) // stored TS is strictly newer

    const put = await call(app, { method: 'PUT', url: '/api/timeOff/to1', payload: stale, headers: { cookie } })
    expect(put.statusCode).toBe(409)
    expect((put.json() as { current?: Record<string, unknown> }).current?.id).toBe('to1') // payload present…
    expect(put.body).not.toContain(SENTINEL) // …but the note never rides it

    const batch = await call(app, {
      method: 'POST',
      url: '/api/batch',
      payload: { ops: [{ method: 'PUT', table: 'timeOff', id: 'to1', row: stale }] },
      headers: { cookie },
    })
    expect(batch.statusCode).toBe(409)
    expect((batch.json() as { current?: Record<string, unknown> }).current?.id).toBe('to1')
    expect(batch.body).not.toContain(SENTINEL)
  })

  it('editor PATCH of an unrelated field → 200 and the note SURVIVES (and a smuggled note change is pinned back)', async () => {
    const { app, db, cookie } = await memberApp('editor')
    const patched = await call(app, {
      method: 'PATCH',
      url: '/api/timeOff/to1',
      payload: { type: 'sick', note: 'smuggled edit of a note I cannot see' },
      headers: { cookie },
    })
    expect(patched.statusCode).toBe(200)
    expect(noteInDb(db)).toBe(SENTINEL) // the crafted note change did not land
    // PATCH's merge pulls the stored row (note included) into its echo — redactNoteEcho must strip
    // it for a note-blind patcher, closing the pre-existing merge-echo leak.
    expect(patched.body).not.toContain(SENTINEL)
  })

  it('editor CREATE of NEW time off works; a note they cannot see is stripped, not stored', async () => {
    const { app, db, cookie } = await memberApp('editor')
    const res = await call(app, {
      method: 'POST',
      url: '/api/timeOff',
      payload: { ...timeOff('to2', 'a1', 'r1'), note: 'smuggled onto a create' },
      headers: { cookie },
    })
    expect(res.statusCode).toBe(201) // the create itself is fine — nothing existing to preserve
    expect((db.prepare(`SELECT note FROM timeOff WHERE id = 'to2'`).get() as { note: unknown }).note).toBeNull()
  })

  it.each(['owner', 'admin'] as const)('%s PUT can still CHANGE the note, and clear it by omitting the key', async (role) => {
    const { app, db, cookie } = await memberApp(role)
    const changed = await call(app, {
      method: 'PUT',
      url: '/api/timeOff/to1',
      payload: stampedTimeOff({ note: 'rescheduled to March' }),
      headers: { cookie },
    })
    expect(changed.statusCode).toBe(200)
    expect(noteInDb(db)).toBe('rescheduled to March')

    const cleared = await call(app, {
      method: 'PUT',
      url: '/api/timeOff/to1',
      payload: stampedTimeOff(), // note key absent — a note-visible writer clears it
      headers: { cookie },
    })
    expect(cleared.statusCode).toBe(200)
    expect(noteInDb(db)).toBeNull()
  })

  it('OFF mode (trusted-local): PUT without the note key still clears it — pre-change behaviour intact', async () => {
    const db = openDb(':memory:')
    const app = buildApp(db) // OFF ⇒ the writer always "sees" the note
    seedTwo(db)
    const res = await call(app, { method: 'PUT', url: '/api/timeOff/to1', payload: stampedTimeOff() })
    expect(res.statusCode).toBe(200)
    expect(noteInDb(db)).toBeNull()
  })
})

describe('P1.5 authorize — account hard-delete is owner-only, both vectors gated', () => {
  // Account hard-delete CASCADES (FK ON DELETE CASCADE wipes all the account's scoped data), so in
  // auth-on it must NOT be reachable by an arbitrary signed-in user. Two vectors: the direct
  // DELETE /api/accounts/:id route, and a POST /api/batch op {method:'DELETE',table:'accounts',id}
  // (the client's real delete-company path). Both gate the dedicated owner-only `deleteAccount`
  // capability against the account's OWN id; admin-tier record purge remains a separate action.

  const deleteAccount = (app: FastifyInstance, id: string, cookie?: string) =>
    call(app, { method: 'DELETE', url: `/api/accounts/${id}`, headers: cookie ? { cookie } : {} })

  const batchDeleteAccount = (app: FastifyInstance, id: string, cookie?: string) =>
    call(app, {
      method: 'POST',
      url: '/api/batch',
      payload: { ops: [{ method: 'DELETE', table: 'accounts', id }] },
      headers: cookie ? { cookie } : {},
    })

  /** Does the accounts row still exist? Read it back via a member with read access (resolveRole). */
  const accountExists = async (app: FastifyInstance, id: string, cookie: string): Promise<boolean> => {
    const res = await getState(app, id, cookie)
    return res.statusCode === 200 && Array.isArray(res.json().accounts) && res.json().accounts.length === 1
  }

  it('non-member: direct DELETE /api/accounts/a1 → 403, and batch accounts-DELETE → 403; a1 survives', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const { cookie } = await signUp(app, 'stranger-del@capacitylens.dev') // NO membership
    // A separate ADMIN of a1 so we can read a1 back afterwards (the stranger can't read it).
    const admin = await signUp(app, 'a1admin-witness@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: admin.userId, role: 'admin', status: 'active', createdAt: TS })

    expect((await deleteAccount(app, 'a1', cookie)).statusCode).toBe(403)
    expect(await accountExists(app, 'a1', admin.cookie)).toBe(true)

    expect((await batchDeleteAccount(app, 'a1', cookie)).statusCode).toBe(403)
    // Pre-scan rejected the batch before the tx opened — a1 left wholly intact.
    expect(await accountExists(app, 'a1', admin.cookie)).toBe(true)
  })

  it.each(['viewer', 'editor', 'admin'] as const)('%s of a1: both account-delete vectors → 403 (owner-only)', async (role) => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const { cookie, userId } = await signUp(app, `${role}-del@capacitylens.dev`)
    upsertMember(db, { accountId: 'a1', userId, role, status: 'active', createdAt: TS })
    // A read-witness owner so the survival read-back can resolve a role for a1.
    const owner = await signUp(app, `${role}-del-witness@capacitylens.dev`)
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })

    expect((await deleteAccount(app, 'a1', cookie)).statusCode).toBe(403)
    expect((await batchDeleteAccount(app, 'a1', cookie)).statusCode).toBe(403)
    expect(await accountExists(app, 'a1', owner.cookie)).toBe(true)
  })

  it('owner of an account: DELETE /api/accounts/:id → 204 (account gone)', async () => {
    const { app, db } = await appWithAuth()
    insertAll(db, { ...emptyAppData(), accounts: [account('purgeMe')] } as unknown as AppData)
    const { cookie, userId } = await signUp(app, 'owner-delete@capacitylens.dev')
    upsertMember(db, { accountId: 'purgeMe', userId, role: 'owner', status: 'active', createdAt: TS })

    const res = await deleteAccount(app, 'purgeMe', cookie)
    expect(res.statusCode).toBe(204)
    // P2.6b: this is now a TENANT ERASURE, not a bare row delete. The caller is the SOLE member, so the
    // erasure also removes their identity and KILLS their session — their cookie no longer authenticates, so a
    // read-back as them is 401 (not 200). "Account gone" is therefore asserted on observable DB state
    // directly: the accounts row, the membership row, and the member's auth session are all removed.
    expect((db.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE id = 'purgeMe'`).get() as { n: number }).n).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) AS n FROM account_members WHERE accountId = 'purgeMe'`).get() as { n: number }).n).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) AS n FROM session WHERE userId = ?`).get(userId) as { n: number }).n).toBe(0)
  })

  it('owner of an account: batch accounts-DELETE op → 200 (account gone)', async () => {
    const { app, db } = await appWithAuth()
    insertAll(db, { ...emptyAppData(), accounts: [account('purgeBatch')] } as unknown as AppData)
    const { cookie, userId } = await signUp(app, 'owner-delete-batch@capacitylens.dev')
    upsertMember(db, { accountId: 'purgeBatch', userId, role: 'owner', status: 'active', createdAt: TS })

    const res = await batchDeleteAccount(app, 'purgeBatch', cookie)
    expect(res.statusCode).toBe(200)
    // P2.6b: the batch accounts-DELETE is the SAME tenant erasure as the direct route — the sole
    // member's session is killed, so a read-back as them no longer authenticates. Assert "account gone"
    // on observable DB state directly (the erasure is fully exercised by app.erasure.test.ts).
    expect((db.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE id = 'purgeBatch'`).get() as { n: number }).n).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) AS n FROM account_members WHERE accountId = 'purgeBatch'`).get() as { n: number }).n).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) AS n FROM session WHERE userId = ?`).get(userId) as { n: number }).n).toBe(0)
  })
})

describe("P1.5 authorize — /api/import is admin-tier ('purge'), not editor-tier", () => {
  // Import is a destructive delete-all + re-insert of the tenant slice (replaceAccountSlice) — the
  // purge tier's hard-delete semantics — AND it bypasses field-level write pins: every id is
  // remapped, so the P1.6 timeOff note pin can never match a stored row. At 'write' tier a
  // note-blind editor could erase every owner-confidential note simply by importing their own
  // (note-redacted) export. OFF mode stays open (see the OFF-mode allow-all suite).

  const importSlice = (app: FastifyInstance, accountId: string, cookie: string) => {
    // A realistic attack payload: the editor's own export of a1 — note-LESS by construction
    // (their reads are redacted), so importing it would silently erase the stored note.
    const data = {
      ...emptyAppData(),
      resources: [person('r1', accountId)],
      timeOff: [timeOff('to1', accountId, 'r1')], // no note key
    }
    return call(app, { method: 'POST', url: '/api/import', payload: { accountId, data }, headers: { cookie } })
  }

  it.each(['viewer', 'editor'] as const)('%s of a1 → 403 and the slice (sentinel note included) survives', async (role) => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const { cookie, userId } = await signUp(app, `${role}-import@capacitylens.dev`)
    upsertMember(db, { accountId: 'a1', userId, role, status: 'active', createdAt: TS })

    expect((await importSlice(app, 'a1', cookie)).statusCode).toBe(403)
    // Nothing was replaced: the seeded client is still there and the confidential note is intact.
    const row = db.prepare(`SELECT note FROM timeOff WHERE id = 'to1'`).get() as { note: unknown }
    expect(row.note).toBe(SENTINEL_TIMEOFF_NOTE)
    expect((db.prepare(`SELECT COUNT(*) AS n FROM clients WHERE id = 'c1'`).get() as { n: number }).n).toBe(1)
  })

  it.each(['admin', 'owner'] as const)('%s of a1 → 200 (a note-VISIBLE role may replace the slice, note included)', async (role) => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const { cookie, userId } = await signUp(app, `${role}-import@capacitylens.dev`)
    upsertMember(db, { accountId: 'a1', userId, role, status: 'active', createdAt: TS })

    const res = await importSlice(app, 'a1', cookie)
    expect(res.statusCode).toBe(200)
    expect(res.json().imported).toBeGreaterThan(0)
  })
})

describe('P1.5 authorize — account WRITE (PUT/PATCH/batch) is gated, not just DELETE', () => {
  // The scoped tables carry accountId and pass through the isScopedTable() authorize gate; `accounts`
  // does NOT (top-level, no accountId column), so a bare account UPDATE (rename / colour / scheduling
  // mode / feature toggles) needs its OWN gate — else any signed-in user could rewrite another tenant's
  // company settings. An UPDATE (existing row) requires membership + write tier; a CREATE (no existing
  // row) is CLOSED auth-on (403 → POST /api/orgs; the old onboarding exemption is retired) and open
  // only in OFF mode. OFF mode stays allow-all. (Regression for the cross-tenant account-write gap —
  // see decisions-log.)

  const putAccount = (app: FastifyInstance, id: string, cookie?: string) =>
    call(app, { method: 'PUT', url: `/api/accounts/${id}`, payload: account(id), headers: cookie ? { cookie } : {} })
  const patchAccount = (app: FastifyInstance, id: string, cookie?: string) =>
    call(app, { method: 'PATCH', url: `/api/accounts/${id}`, payload: { name: 'Renamed' }, headers: cookie ? { cookie } : {} })
  const batchPutAccount = (app: FastifyInstance, id: string, cookie?: string) =>
    call(app, {
      method: 'POST',
      url: '/api/batch',
      payload: { ops: [{ method: 'PUT', table: 'accounts', id, row: account(id) }] },
      headers: cookie ? { cookie } : {},
    })

  it('non-member (signed in): PUT / PATCH / batch-PUT updating a1 → 403', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const { cookie } = await signUp(app, 'acct-stranger@capacitylens.dev') // NO membership
    expect((await putAccount(app, 'a1', cookie)).statusCode).toBe(403)
    expect((await patchAccount(app, 'a1', cookie)).statusCode).toBe(403)
    expect((await batchPutAccount(app, 'a1', cookie)).statusCode).toBe(403)
  })

  it('cross-account: a member of a1 only, updating a2 → 403 (all three vectors)', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const { cookie, userId } = await signUp(app, 'acct-a1only@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'admin', status: 'active', createdAt: TS })
    expect((await putAccount(app, 'a2', cookie)).statusCode).toBe(403)
    expect((await patchAccount(app, 'a2', cookie)).statusCode).toBe(403)
    expect((await batchPutAccount(app, 'a2', cookie)).statusCode).toBe(403)
  })

  it('viewer of a1: account update → 403 (write tier); editor of a1: → 2xx', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const viewer = await signUp(app, 'acct-viewer@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: viewer.userId, role: 'viewer', status: 'active', createdAt: TS })
    expect((await patchAccount(app, 'a1', viewer.cookie)).statusCode).toBe(403)

    const editor = await signUp(app, 'acct-editor@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: editor.userId, role: 'editor', status: 'active', createdAt: TS })
    expect((await putAccount(app, 'a1', editor.cookie)).statusCode).toBe(200)
    expect((await patchAccount(app, 'a1', editor.cookie)).statusCode).toBe(200)
    expect((await batchPutAccount(app, 'a1', editor.cookie)).statusCode).toBe(200)
  })

  // Auth-on, a CREATE via any generic vector is CLOSED outright — 403 directing to POST /api/orgs
  // (the atomic account + Internal client + owner-membership path). The refusal is UNCONDITIONAL in
  // auth-on: it fires ahead of the single-company cap, at zero accounts (the bootstrap case now
  // belongs to /api/orgs too), and regardless of multiAccount. Three cases pin the full behaviour:
  it('(a) zero-account instance, auth-on: a non-member PUT / batch-PUT of the FIRST account → 403 → /api/orgs (bootstrap moved there)', async () => {
    const put = await appWithAuth() // fresh db, zero accounts
    const { cookie: putCookie } = await signUp(put.app, 'acct-onboard-put@capacitylens.dev') // no membership
    const putRes = await putAccount(put.app, 'brandNew1', putCookie)
    expect(putRes.statusCode).toBe(403)
    expect(putRes.json().error).toContain('/api/orgs')
    expect((put.db.prepare(`SELECT COUNT(*) AS n FROM accounts`).get() as { n: number }).n).toBe(0)

    const batch = await appWithAuth() // separate fresh instance — also zero accounts
    const { cookie: batchCookie } = await signUp(batch.app, 'acct-onboard-batch@capacitylens.dev')
    const batchRes = await batchPutAccount(batch.app, 'brandNew2', batchCookie)
    expect(batchRes.statusCode).toBe(403)
    expect(batchRes.json().error).toContain('/api/orgs')
    expect((batch.db.prepare(`SELECT COUNT(*) AS n FROM accounts`).get() as { n: number }).n).toBe(0)
  })

  it('(b) instance with ≥1 account, default opts: a non-member PUT / batch-PUT of a NEW account → 403 → /api/orgs (the auth-on closure outranks the cap message)', async () => {
    const { app, db } = await appWithAuth() // multiAccount defaults to false
    seedTwo(db) // a1 + a2 already exist
    const { cookie } = await signUp(app, 'acct-onboard-cap@capacitylens.dev') // no membership

    const put = await putAccount(app, 'brandNew3', cookie)
    expect(put.statusCode).toBe(403)
    expect(put.json().error).toContain('/api/orgs')

    const batch = await batchPutAccount(app, 'brandNew4', cookie)
    expect(batch.statusCode).toBe(403)
    expect(batch.json().error).toContain('/api/orgs')
    // /api/orgs then applies the single-company cap itself (its own GATE 0) — see app.orgs.test.ts.
  })

  it('(c) multiAccount: true does NOT reopen the generic vectors auth-on — creation still goes through /api/orgs', async () => {
    const { app, db } = await appWithAuth({ multiAccount: true })
    seedTwo(db)
    const { cookie } = await signUp(app, 'acct-onboard-multi@capacitylens.dev') // no membership
    expect((await putAccount(app, 'brandNew5', cookie)).statusCode).toBe(403)
    expect((await batchPutAccount(app, 'brandNew6', cookie)).statusCode).toBe(403)
    expect((db.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE id LIKE 'brandNew%'`).get() as { n: number }).n).toBe(0)
  })

  it('OFF mode: account update (PUT/PATCH/batch) is allow-all (no cookie, no membership)', async () => {
    const db = openDb(':memory:')
    const app = buildApp(db) // OFF
    seedTwo(db)
    expect((await putAccount(app, 'a1')).statusCode).toBe(200)
    expect((await patchAccount(app, 'a1')).statusCode).toBe(200)
    expect((await batchPutAccount(app, 'a1')).statusCode).toBe(200)
  })
})

describe('P1.5 authorize — OFF mode stays allow-all/no-op (the #1 invariant)', () => {
  // No authMode ⇒ OFF (trusted-local). Every read/write succeeds, INCLUDING cross-account ids —
  // authorize() short-circuits to true on its first line, so resolveRole/can never run.
  function offApp(): FastifyInstance {
    const db = openDb(':memory:')
    const app = buildApp(db, { allowReset: true })
    seedTwo(db)
    return app
  }

  it('reads any account (no cookie) → 200', async () => {
    const app = offApp()
    expect((await getState(app, 'a1')).statusCode).toBe(200)
    expect((await getState(app, 'a2')).statusCode).toBe(200)
  })

  it('every write (incl. cross-account ids) succeeds with NO membership and NO session', async () => {
    const app = offApp()
    expect((await postClient(app, 'a1', 'off1')).statusCode).toBe(201)
    expect((await postClient(app, 'a2', 'off2')).statusCode).toBe(201)
    expect((await putClient(app, 'a2', 'off3')).statusCode).toBe(200)
    expect((await patchClient(app, 'c2')).statusCode).toBe(200)
    expect((await deleteProject(app, 'a2', 'p2')).statusCode).toBe(204)
    expect((await batchInto(app, 'a2', 'off4')).statusCode).toBe(200)
    expect((await importInto(app, 'a2', 'off5')).statusCode).toBe(200)
  })

  it('account hard-delete still works (no-op gate): direct DELETE + batch accounts-DELETE → 2xx', async () => {
    // Pins the default deploy can still delete companies — the 'purge' gate short-circuits to allow
    // in OFF, so neither vector is blocked by the new auth-on guard.
    const app = offApp()
    // Direct route: DELETE /api/accounts/a1 (no cookie, no membership) → 204.
    const direct = await call(app, { method: 'DELETE', url: '/api/accounts/a1' })
    expect(direct.statusCode).toBe(204)
    // Batch op: {method:'DELETE',table:'accounts',id:'a2'} → 200.
    const batch = await call(app, {
      method: 'POST',
      url: '/api/batch',
      payload: { ops: [{ method: 'DELETE', table: 'accounts', id: 'a2' }] },
    })
    expect(batch.statusCode).toBe(200)
  })
})

describe('P1.5 access matrix sanity (pure can()) — companion to access.test.ts', () => {
  // The route gate above proves read/write tiers end-to-end; pin the remaining distinctions directly
  // against the pure authority too, including record purge vs whole-account deletion.
  it('admin can manage and purge records but cannot delete an account or transfer ownership', () => {
    const editor: Role = 'editor'
    const admin: Role = 'admin'
    const owner: Role = 'owner'
    expect(can(editor, 'manageMembers')).toBe(false)
    expect(can(admin, 'manageMembers')).toBe(true)
    expect(can(admin, 'purge')).toBe(true)
    expect(can(admin, 'deleteAccount')).toBe(false)
    expect(can(owner, 'deleteAccount')).toBe(true)
    expect(can(admin, 'transferOwnership')).toBe(false)
    expect(can(owner, 'transferOwnership')).toBe(true)
  })
})
