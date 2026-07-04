import { describe, it, expect } from 'vitest'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import { buildApp } from './app'
import { openDb, insertAll, type Db } from './db'
import { upsertMember } from './controlTables'
import { authFromEnv, runAuthMigrations } from './auth'
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

const call = (app: FastifyInstance, opts: InjectOptions): Promise<LightMyRequestResponse> =>
  app.inject(opts) as unknown as Promise<LightMyRequestResponse>

/** Collapse a response's Set-Cookie header(s) into one request Cookie header. */
function cookiesOf(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie']
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  return list.map((c) => String(c).split(';')[0]).join('; ')
}

const PASSWORD_ENV = {
  CAPACITYLENS_AUTH: 'password',
  BETTER_AUTH_SECRET: 'unit-test-secret-0123456789abcdef-0123',
  BETTER_AUTH_URL: 'http://localhost:8787',
  // P1.7: open email signup is closed by DEFAULT; these fixtures create test users via
  // sign-up/email, so re-open it explicitly until the invite flow (P1.9/P1.10) exists.
  CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1',
}

/** Build an auth-on (password) app over a fresh in-memory DB, returning both so the test can seed.
 *  `multiAccount` defaults to the single-company-cap OFF default (false) — pass `true` for a test
 *  that deliberately exercises a multi-company instance. */
async function appWithAuth(opts: { multiAccount?: boolean } = {}): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(':memory:')
  const { mode, auth } = authFromEnv(db, PASSWORD_ENV)
  await runAuthMigrations(auth!)
  return { app: buildApp(db, { authMode: mode, auth, multiAccount: opts.multiAccount }), db }
}

/** Sign up a user, returning its session cookie + the resolved user id (from /api/auth/me). */
async function signUp(app: FastifyInstance, email: string): Promise<{ cookie: string; userId: string }> {
  const res = await call(app, {
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password: 'password-123', name: 'Tester' },
  })
  expect(res.statusCode).toBe(200)
  const cookie = cookiesOf(res)
  const me = await call(app, { method: 'GET', url: '/api/auth/me', headers: { cookie } })
  expect(me.statusCode).toBe(200)
  return { cookie, userId: me.json().user.id as string }
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

  it('editor of a1: read → 200; every write to a1 → 2xx', async () => {
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
    expect((await importInto(app, 'a1', 'ec4', cookie)).statusCode).toBe(200)
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

  it('account-lifecycle exemption: a signed-in user with NO membership can POST /api/accounts → 201', async () => {
    const { app } = await appWithAuth()
    const { cookie } = await signUp(app, 'onboarding@capacitylens.dev') // no membership → no account yet
    const res = await call(app, {
      method: 'POST',
      url: '/api/accounts',
      payload: account('newAcct'),
      headers: { cookie },
    })
    // 201: account creation is NOT gated (there is no createAccount Action) so a fresh user can
    // bootstrap their first company — see the P1.5 account-lifecycle deferral in app.ts.
    expect(res.statusCode).toBe(201)
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

describe('P1.5 authorize — account hard-delete is admin+ ("purge"), both vectors gated', () => {
  // Account hard-delete CASCADES (FK ON DELETE CASCADE wipes all the account's scoped data), so in
  // auth-on it must NOT be reachable by an arbitrary signed-in user. Two vectors: the direct
  // DELETE /api/accounts/:id route, and a POST /api/batch op {method:'DELETE',table:'accounts',id}
  // (the client's real delete-company path). Both gate 'purge' (admin+) against the account's OWN id.

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

  it.each(['viewer', 'editor'] as const)('%s of a1: DELETE /api/accounts/a1 → 403 (purge is admin+)', async (role) => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const { cookie, userId } = await signUp(app, `${role}-del@capacitylens.dev`)
    upsertMember(db, { accountId: 'a1', userId, role, status: 'active', createdAt: TS })
    // A read-witness admin so the survival read-back can resolve a role for a1.
    const admin = await signUp(app, `${role}-del-witness@capacitylens.dev`)
    upsertMember(db, { accountId: 'a1', userId: admin.userId, role: 'admin', status: 'active', createdAt: TS })

    expect((await deleteAccount(app, 'a1', cookie)).statusCode).toBe(403)
    expect((await batchDeleteAccount(app, 'a1', cookie)).statusCode).toBe(403)
    expect(await accountExists(app, 'a1', admin.cookie)).toBe(true)
  })

  it.each(['admin', 'owner'] as const)('%s of an account: DELETE /api/accounts/:id → 2xx (account gone)', async (role) => {
    // Fresh account per success case so we never delete an account other assertions rely on.
    const { app, db } = await appWithAuth()
    insertAll(db, { ...emptyAppData(), accounts: [account('purgeMe')] } as unknown as AppData)
    const { cookie, userId } = await signUp(app, `${role}-purge@capacitylens.dev`)
    upsertMember(db, { accountId: 'purgeMe', userId, role, status: 'active', createdAt: TS })

    const res = await deleteAccount(app, 'purgeMe', cookie)
    expect(res.statusCode).toBe(204)
    // P2.6b: this is now a TENANT ERASURE, not a bare row delete. The caller is the SOLE member, so the
    // erasure also scrubs their PII and KILLS their session — their cookie no longer authenticates, so a
    // read-back as them is 401 (not 200). "Account gone" is therefore asserted on observable DB state
    // directly: the accounts row, the membership row, and the member's auth session are all removed.
    expect((db.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE id = 'purgeMe'`).get() as { n: number }).n).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) AS n FROM account_members WHERE accountId = 'purgeMe'`).get() as { n: number }).n).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) AS n FROM session WHERE userId = ?`).get(userId) as { n: number }).n).toBe(0)
  })

  it('admin of an account: batch accounts-DELETE op → 2xx (account gone)', async () => {
    const { app, db } = await appWithAuth()
    insertAll(db, { ...emptyAppData(), accounts: [account('purgeBatch')] } as unknown as AppData)
    const { cookie, userId } = await signUp(app, 'admin-purge-batch@capacitylens.dev')
    upsertMember(db, { accountId: 'purgeBatch', userId, role: 'admin', status: 'active', createdAt: TS })

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

describe('P1.5 authorize — account WRITE (PUT/PATCH/batch) is gated, not just DELETE', () => {
  // The scoped tables carry accountId and pass through the isScopedTable() authorize gate; `accounts`
  // does NOT (top-level, no accountId column), so a bare account UPDATE (rename / colour / scheduling
  // mode / feature toggles) needs its OWN gate — else any signed-in user could rewrite another tenant's
  // company settings. An UPDATE (existing row) requires membership + write tier; a CREATE (no existing
  // row) stays OPEN per the onboarding exemption. OFF mode stays allow-all. (Regression for the
  // cross-tenant account-write gap — see decisions-log.)

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

  // The single-company cap (AppOptions.multiAccount, default off) sits IN FRONT of this "CREATE
  // stays open" onboarding exemption: a CREATE is unconditionally open only while the instance is
  // still at zero accounts (the bootstrap case); once any account exists, it needs multiAccount:true
  // like every other create vector. Three cases pin the full behaviour:
  it('(a) zero-account instance: a non-member may PUT / batch-PUT the FIRST account → 2xx (bootstrap survives)', async () => {
    const put = await appWithAuth() // fresh db, zero accounts
    const { cookie: putCookie } = await signUp(put.app, 'acct-onboard-put@capacitylens.dev') // no membership
    expect((await putAccount(put.app, 'brandNew1', putCookie)).statusCode).toBe(200)

    const batch = await appWithAuth() // separate fresh instance — also zero accounts
    const { cookie: batchCookie } = await signUp(batch.app, 'acct-onboard-batch@capacitylens.dev')
    expect((await batchPutAccount(batch.app, 'brandNew2', batchCookie)).statusCode).toBe(200)
  })

  it('(b) instance with ≥1 account, default opts: a non-member PUT / batch-PUT of a NEW account → 403 (single-company cap, not a generic Forbidden)', async () => {
    const { app, db } = await appWithAuth() // multiAccount defaults to false
    seedTwo(db) // a1 + a2 already exist
    const { cookie } = await signUp(app, 'acct-onboard-cap@capacitylens.dev') // no membership
    const CAP_MESSAGE = 'This instance allows a single company. Set CAPACITYLENS_MULTI_ACCOUNT=1 to allow more.'

    const put = await putAccount(app, 'brandNew3', cookie)
    expect(put.statusCode).toBe(403)
    expect(put.json()).toEqual({ error: CAP_MESSAGE })

    const batch = await batchPutAccount(app, 'brandNew4', cookie)
    expect(batch.statusCode).toBe(403)
    expect(batch.json()).toEqual({ error: CAP_MESSAGE })
  })

  it('(c) multiAccount: true restores the old CREATE-stays-open behaviour even with existing accounts', async () => {
    const { app, db } = await appWithAuth({ multiAccount: true })
    seedTwo(db)
    const { cookie } = await signUp(app, 'acct-onboard-multi@capacitylens.dev') // no membership
    expect((await putAccount(app, 'brandNew5', cookie)).statusCode).toBe(200)
    expect((await batchPutAccount(app, 'brandNew6', cookie)).statusCode).toBe(200)
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
  // The route gate above proves read/write tiers end-to-end; the manage*/purge/transferOwnership
  // actions have no routes yet (matrix-only), so pin them directly here against the pure authority.
  it('editor cannot manageMembers; admin can manageMembers but not transferOwnership; owner can transfer', () => {
    const editor: Role = 'editor'
    const admin: Role = 'admin'
    const owner: Role = 'owner'
    expect(can(editor, 'manageMembers')).toBe(false)
    expect(can(admin, 'manageMembers')).toBe(true)
    expect(can(admin, 'transferOwnership')).toBe(false)
    expect(can(owner, 'transferOwnership')).toBe(true)
  })
})
