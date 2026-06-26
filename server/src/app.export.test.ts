import { describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'
import { openDb, insertAll, type Db } from './db'
import { upsertMember, createInvite, newInviteId } from './controlTables'
import { authFromEnv, runAuthMigrations } from './auth'
import { emptyAppData, type AppData } from '@capacitylens/shared/types/entities'

// P2.6a — TEST-LOCK for the COMPLETE PER-TENANT EXPORT.
//
// The "complete per-tenant backup" the roadmap (CapacityLens.md P2.6) asks for is NOT a new route: it
// is the EXISTING `GET /api/state?accountId=X&includeInactive=1` admin read (server/src/app.ts), which
// returns exactly ONE account's slice via store.readSlice(accountId, { includeInactive: true }). This
// suite locks the two backup guarantees so a future change can't silently regress them:
//   (1) FULL SLICE incl. inactive — archived + soft-deleted rows are RETAINED (a backup keeps them),
//       and the no-flag read PROVES includeInactive is what flips that (P2.4 active-only contrast).
//   (2) CONTROL TABLES / PII ABSENT — account_members / invites (membership + invite secrets/PII) are
//       structurally excluded from the slice (readSlice never reads the control plane). Mirrors the
//       absence assertions in app.controlTables.test.ts.
// Admin gating (non-admin → 403) is already exhaustively covered by app.lifecycle.test.ts's "auth-on
// 403 permission matrix" (viewer/editor read-inactive → 403); one focused 403 case is included here so
// the export's privilege boundary is asserted alongside its payload guarantees.

const TS = '2026-01-01T00:00:00.000Z'
const meta = () => ({ createdAt: TS, updatedAt: TS })
const account = (id: string) => ({ id, name: `Studio ${id}`, color: '#3b82f6', ...meta() })
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

// A soft-delete TOMBSTONE (deletedAt set; archivedAt precedes it because soft-delete requires prior
// archival) and a plain ARCHIVED marker — the two non-active states a complete backup must retain.
const ARCHIVED = { archivedAt: TS }
const TOMBSTONE = { archivedAt: TS, deletedAt: '2026-01-02T00:00:00.000Z' }

const PASSWORD_ENV = {
  CAPACITYLENS_AUTH: 'password',
  BETTER_AUTH_SECRET: 'unit-test-secret-0123456789abcdef-0123',
  BETTER_AUTH_URL: 'http://localhost:8787',
  CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1',
}

/** Build an auth-on (password) app over a fresh in-memory DB, returning both so the test can seed. */
async function appWithAuth(): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(':memory:')
  const { mode, auth } = authFromEnv(db, PASSWORD_ENV)
  await runAuthMigrations(auth!)
  return { app: buildApp(db, { authMode: mode, auth }), db }
}

/** Sign up a user, returning its session cookie + resolved user id (from /api/auth/me). */
async function signUp(app: FastifyInstance, email: string): Promise<{ cookie: string; userId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password: 'password-123', name: 'Tester' },
  })
  expect(res.statusCode).toBe(200)
  const raw = res.headers['set-cookie']
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  const cookie = list.map((c) => String(c).split(';')[0]).join('; ')
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
  expect(me.statusCode).toBe(200)
  return { cookie, userId: me.json().user.id as string }
}

/**
 * Seed account a1 with three resources spanning every lifecycle state the backup must retain:
 *  - rActive: ACTIVE (visible in both the normal and the complete read)
 *  - rArchived: ARCHIVED (archivedAt set — retained only by the complete read)
 *  - rDeleted: SOFT-DELETED tombstone (deletedAt set — retained only by the complete read)
 * a2 carries an unrelated resource so the per-account scoping is testable.
 */
function seedResources(db: Db): void {
  const d = emptyAppData() as unknown as Record<string, unknown[]>
  d.accounts = [account('a1'), account('a2')]
  d.resources = [
    person('rActive', 'a1'),
    person('rArchived', 'a1', ARCHIVED),
    person('rDeleted', 'a1', TOMBSTONE),
    person('rOther', 'a2'),
  ]
  insertAll(db, d as unknown as AppData)
}

const ids = (body: { resources: { id: string }[] }) => body.resources.map((r) => r.id)

describe('P2.6a complete per-tenant export — full slice INCLUDING inactive (the backup guarantee)', () => {
  it('?includeInactive=1 returns the active, archived AND soft-deleted resources (none dropped)', async () => {
    // OFF mode is trusted-local ⇒ the includeInactive read needs no auth; keeps the payload assertion
    // free of the auth harness (the gate itself is asserted in the dedicated 403 test below).
    const db = openDb(':memory:')
    const app = buildApp(db)
    seedResources(db)

    const res = await app.inject({ method: 'GET', url: '/api/state?accountId=a1&includeInactive=1' })
    expect(res.statusCode).toBe(200)
    const got = ids(res.json())
    // The complete backup RETAINS every row — including the two non-active tombstones.
    expect(got).toContain('rActive')
    expect(got).toContain('rArchived')
    expect(got).toContain('rDeleted')
    // Per-account scoping: a2's resource never appears in a1's export.
    expect(got).not.toContain('rOther')
  })

  it('the no-flag read of the SAME account omits archived + soft-deleted (P2.4 active-only contrast)', async () => {
    // Proves includeInactive is precisely what flips the projection: the normal app read passes
    // includeInactive:false ⇒ readSlice applies activeOnly ⇒ tombstones are hidden. Same account,
    // same data, only the flag differs.
    const db = openDb(':memory:')
    const app = buildApp(db)
    seedResources(db)

    const res = await app.inject({ method: 'GET', url: '/api/state?accountId=a1' })
    expect(res.statusCode).toBe(200)
    const got = ids(res.json())
    expect(got).toContain('rActive') // the active row survives both reads…
    expect(got).not.toContain('rArchived') // …but the archived + tombstoned rows are dropped here.
    expect(got).not.toContain('rDeleted')
  })
})

describe('P2.6a complete per-tenant export — server-control tables / PII structurally absent', () => {
  it('a seeded membership + invite never ride the export (no account_members, userId, token or preauthEmail)', async () => {
    const db = openDb(':memory:')
    const app = buildApp(db)
    seedResources(db)

    // Seed the control plane DIRECTLY (the only path that touches it): a membership row and a live
    // invite carrying a bearer token + a preauth email — exactly the secrets/PII an export must never leak.
    const MEMBER_USER_ID = 'member-secret-user-id-XYZ'
    const INVITE_TOKEN = 'invite-bearer-token-SECRET-XYZ'
    const INVITE_EMAIL = 'preauth-secret@capacitylens.dev'
    upsertMember(db, { accountId: 'a1', userId: MEMBER_USER_ID, role: 'owner', status: 'active', createdAt: TS })
    createInvite(db, {
      token: INVITE_TOKEN,
      id: newInviteId(),
      accountId: 'a1',
      role: 'editor',
      preauthEmail: INVITE_EMAIL,
      expiresAt: '2099-01-01T00:00:00.000Z',
      usedAt: null,
      createdAt: TS,
    })

    const res = await app.inject({ method: 'GET', url: '/api/state?accountId=a1&includeInactive=1' })
    expect(res.statusCode).toBe(200)
    const state = res.json() as Record<string, unknown>
    // No control-table KEY on the wire shape.
    expect(state).not.toHaveProperty('account_members')
    expect(state).not.toHaveProperty('invites')
    // No control-plane VALUE anywhere in the serialised export (mirrors app.controlTables.test.ts):
    // the table name, the member's userId, the invite's bearer token, and the preauth email are all absent.
    const serialised = JSON.stringify(state)
    expect(serialised).not.toContain('account_members')
    expect(serialised).not.toContain(MEMBER_USER_ID)
    expect(serialised).not.toContain(INVITE_TOKEN)
    expect(serialised).not.toContain(INVITE_EMAIL)
    // Sanity: the account's OWN data IS in the export (proving we asserted absence on a populated payload).
    expect(ids(res.json())).toContain('rActive')
  })
})

describe('P2.6a complete per-tenant export — admin/purge-tier gating (auth-on)', () => {
  it('a non-admin (editor) requesting ?includeInactive=1 → 403 (no backup for non-admins)', async () => {
    const { app, db } = await appWithAuth()
    seedResources(db)
    const { cookie, userId } = await signUp(app, 'editor-export@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'editor', status: 'active', createdAt: TS })

    const res = await app.inject({
      method: 'GET',
      url: '/api/state?accountId=a1&includeInactive=1',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(403)
  })
})
