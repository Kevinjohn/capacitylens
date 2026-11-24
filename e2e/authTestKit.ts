import { expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ports } from '../tooling/ports.mjs';
import { buildInternalClient } from '@capacitylens/shared/data/internalClient';
import { FALLBACK_PRESET_COLOR } from '@capacitylens/shared/lib/color';

// Keep password-server fixture setup in one place so bootstrap credentials and request shapes remain consistent.

/** The auth-e2e API origin (the password-auth server the *.auth specs drive). */
// Port lane-derived, exactly as playwright.config.ts derives the port it boots that server on: a literal
// here would point every auth spec at port lane 0 while the server moved.
export const AUTH_API = `http://localhost:${ports().authApi}`;

/** The password every auth-e2e fixture signs up / signs in with. */
export const AUTH_PASSWORD = 'demo-password-123456';

/**
 * Fixed membership-free administrator credentials used only by the disposable auth server.
 * The server creates this user after first-company setup for recovery scenarios.
 * Keep these literals aligned with start:auth-e2e; importing auth.ts would load the auth runtime into Playwright.
 */
export const BOOTSTRAP_ADMIN = { email: 'admin@admin.admin', password: 'auth-e2e-password-2026' };

/** Captures the authenticated session's current masquerade context for one deliberate API action. */
export async function masqueradeTokenHeaders(
  request: APIRequestContext,
  cookie?: string,
  origin = AUTH_API,
): Promise<Record<string, string>> {
  const headers = { 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}) };
  const response = await request.get(`${origin}/api/masquerade`, { headers });
  expect(response.status(), 'read masquerade context for fixture request').toBe(200);
  const masqueradeToken = ((await response.json()) as { data?: { masqueradeToken?: unknown } }).data
    ?.masqueradeToken;
  if (typeof masqueradeToken !== 'string' || masqueradeToken.length === 0)
    throw new Error('Authenticated fixture session did not return a masquerade context token.');
  return { ...headers, 'X-Masquerade-Context': masqueradeToken };
}

const AUTH_E2E_DATABASE = fileURLToPath(new URL('../apps/backend/.auth-e2e.db', import.meta.url));
const BACKEND_DIRECTORY = fileURLToPath(new URL('../apps/backend/', import.meta.url));
const AUTH_E2E_BASELINE_COMPANY = 'Daily Planet E2E Baseline';
const AUTH_E2E_BASELINE_OWNER = 'baseline-owner@capacitylens.dev';

/** Rejects a fixture target outside the one disposable native auth E2E database. */
function assertAuthE2EFixturePath(databasePath: string): void {
  if (resolve(databasePath) !== resolve(AUTH_E2E_DATABASE))
    throw new Error('Auth E2E fixtures may only access apps/backend/.auth-e2e.db.');
  if (!existsSync(databasePath))
    throw new Error(
      'The disposable auth E2E database is unavailable; start the auth E2E server first.',
    );
  if (realpathSync(databasePath) !== resolve(AUTH_E2E_DATABASE))
    throw new Error('Auth E2E fixtures may only access apps/backend/.auth-e2e.db.');
}

/** Opens only the native auth E2E database after verifying its path and schema markers. */
function openAuthE2EDatabase(): DatabaseSync {
  assertAuthE2EFixturePath(AUTH_E2E_DATABASE);
  const db = new DatabaseSync(AUTH_E2E_DATABASE);
  try {
    const main = db
      .prepare('PRAGMA database_list')
      .all()
      .find((database) => database.name === 'main') as { file: string } | undefined;
    if (!main || resolve(main.file) !== resolve(AUTH_E2E_DATABASE))
      throw new Error('Auth E2E fixtures may only access apps/backend/.auth-e2e.db.');

    const tableNames = new Set(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
          name: string;
        }>
      ).map(({ name }) => name),
    );
    if (
      [
        'users',
        'memberships',
        'adonis_sessions',
        'account_sessions',
        'account_admissions',
        'audit_entries',
        'account_member_resources',
        'companies',
        'clients',
        'company_planning_revisions',
      ].some((table) => !tableNames.has(table))
    )
      throw new Error('The database does not match the native auth E2E schema.');

    db.exec('PRAGMA busy_timeout = 5000');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function cookiesOf(setCookie: string): string {
  return setCookie
    .split('\n')
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

async function postSignUp(
  ctx: APIRequestContext,
  email: string,
  name = email.split('@')[0],
): Promise<string> {
  const res = await ctx.post(`${AUTH_API}/api/auth/sign-up`, {
    data: { email, password: AUTH_PASSWORD, name },
    headers: { 'sec-fetch-site': 'same-origin' },
  });
  expect(res.ok(), `sign-up ${email}`).toBeTruthy();
  admitTestUser(email);
  return cookiesOf(res.headers()['set-cookie'] ?? '');
}

/**
 * Confirms a fixture identity's address, standing in for the confirmation email: the E2E servers
 * have no mail transport.
 * @throws When the identity is absent.
 */
function confirmFixtureAddress(email: string): void {
  const db = openAuthE2EDatabase();
  try {
    const confirmed = db
      .prepare(
        'UPDATE users SET email_verified_at = ?, unverified_email = NULL WHERE lower(email) = ?',
      )
      .run(new Date().toISOString(), email.toLowerCase());
    if (confirmed.changes !== 1) throw new Error(`Missing E2E fixture identity for ${email}`);
  } finally {
    db.close();
  }
}

/**
 * Confirms and admits a signed-up fixture identity, standing in for the confirmation email and the
 * operator approval a real installation needs. The admission spec drives approval through the UI.
 * @throws When the identity is absent.
 */
export function admitTestUser(email: string): void {
  confirmFixtureAddress(email);
  const db = openAuthE2EDatabase();
  try {
    const user = db
      .prepare('SELECT id, email FROM users WHERE lower(email) = ?')
      .get(email.toLowerCase()) as { id: string; email: string } | undefined;
    if (!user) throw new Error(`Missing E2E fixture identity for ${email}`);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO account_admissions
         (user_id, invited_email, invitation_source, invitation_recorded_at, approval_status,
          approval_decided_at, created_at, updated_at)
       VALUES (?, ?, 'operator', ?, 'approved', ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         invitation_recorded_at = excluded.invitation_recorded_at,
         approval_status = 'approved',
         approval_decided_at = excluded.approval_decided_at`,
    ).run(user.id, user.email, now, now, now, now);
  } finally {
    db.close();
  }
}

/**
 * Seed only disposable auth-e2e role/access fixtures. Real invitation tests use the addressed invite path.
 * The user must already exist in the disposable auth database.
 * @throws When the user is absent or database writes fail.
 */
export function createTestMember(
  companyId: string,
  email: string,
  role: 'admin' | 'editor' | 'viewer',
): void {
  const db = openAuthE2EDatabase();
  try {
    const user = db
      .prepare('SELECT id FROM users WHERE lower(email) = ?')
      .get(email.toLowerCase()) as { id: string } | undefined;
    if (!user) throw new Error(`Missing E2E fixture identity for ${email}`);
    db.prepare(
      `INSERT INTO memberships (scope_id, user_id, role, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    ).run(companyId, user.id, role, new Date().toISOString(), new Date().toISOString());
  } finally {
    db.close();
  }
}

/** Revokes a disposable E2E user's real session access without relying on browser cookie timing. */
export function revokeTestSessions(email: string): void {
  const db = openAuthE2EDatabase();
  try {
    const user = db
      .prepare('SELECT id FROM users WHERE lower(email) = ?')
      .get(email.toLowerCase()) as { id: string } | undefined;
    if (!user) throw new Error(`Missing E2E fixture identity for ${email}`);
    const removed = db.prepare('DELETE FROM account_sessions WHERE user_id = ?').run(user.id);
    if (removed.changes === 0) throw new Error(`Missing E2E fixture session for ${email}`);
  } finally {
    db.close();
  }
}

function ensureAuthE2EFixtureCompanyTable(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS auth_e2e_fixture_companies (company_id TEXT PRIMARY KEY)');
}

function removeAuthE2ECompany(db: DatabaseSync, companyId: string): void {
  db.prepare('DELETE FROM audit_entries WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM account_member_resources WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM memberships WHERE scope_id = ?').run(companyId);
  db.prepare('DELETE FROM companies WHERE id = ?').run(companyId);
}

function insertAuthE2ECompany(
  db: DatabaseSync,
  input: {
    companyId: string;
    name: string;
    ownerId: string;
    now: string;
    track: boolean;
    recordInitialization: boolean;
  },
): void {
  const { companyId, name, ownerId, now, track, recordInitialization } = input;
  const internal = buildInternalClient(companyId, now);
  db.prepare(
    `INSERT INTO companies (
       id, name, color, scheduling_mode, timezone, week_starts_on, working_days, language,
       disciplines_enabled, placeholders_enabled, external_enabled, inline_activity_create_enabled,
       show_task_field_in_schedule, capacity_overview_access, date_style, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    companyId,
    name,
    FALLBACK_PRESET_COLOR,
    'days',
    null,
    JSON.stringify(1),
    JSON.stringify([1, 2, 3, 4, 5]),
    null,
    0,
    0,
    0,
    0,
    null,
    null,
    null,
    now,
    now,
  );
  db.prepare(
    `INSERT INTO clients (id, company_id, name, color, builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).run(internal.id, companyId, internal.name, internal.color, now, now);
  db.prepare(
    `INSERT INTO memberships (scope_id, user_id, role, status, created_at, updated_at)
     VALUES (?, ?, 'owner', 'active', ?, ?)`,
  ).run(companyId, ownerId, now, now);
  db.prepare('INSERT INTO company_planning_revisions (company_id, revision) VALUES (?, 1)').run(
    companyId,
  );
  if (track)
    db.prepare('INSERT INTO auth_e2e_fixture_companies (company_id) VALUES (?)').run(companyId);
  if (recordInitialization) {
    db.prepare(
      `INSERT INTO audit_entries (id, company_id, actor_id, action, entity, entity_id, details, created_at, updated_at)
       VALUES (?, ?, ?, 'company.initialized', 'company', ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      companyId,
      ownerId,
      companyId,
      JSON.stringify({ changedFields: ['company', 'owner'] }),
      now,
      now,
    );
  }
}

/** Resolves only the untracked placeholder owned by the real first-run fixture identity. */
function temporaryBaselineCompanyIds(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      `SELECT companies.id
       FROM companies
       JOIN memberships ON memberships.scope_id = companies.id
       JOIN users ON users.id = memberships.user_id
       WHERE companies.name = ?
         AND users.email = ?
         AND memberships.role = 'owner'
         AND memberships.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM auth_e2e_fixture_companies WHERE company_id = companies.id
         )`,
    )
    .all(AUTH_E2E_BASELINE_COMPANY, AUTH_E2E_BASELINE_OWNER) as Array<{ id: string }>;
  if (rows.length > 1)
    throw new Error('Multiple retained Auth E2E placeholder companies were found.');
  return rows.map(({ id }) => id);
}

function removeTemporaryBaselineCompany(db: DatabaseSync): void {
  for (const companyId of temporaryBaselineCompanyIds(db)) removeAuthE2ECompany(db, companyId);
}

/** Restores the disposable one-company server state after scenario companies are removed. */
function ensureTemporaryBaselineCompany(db: DatabaseSync): void {
  if (db.prepare('SELECT id FROM companies LIMIT 1').get()) return;
  const owner = db.prepare('SELECT id FROM users WHERE email = ?').get(AUTH_E2E_BASELINE_OWNER) as
    { id: string } | undefined;
  if (!owner) throw new Error('The real Auth E2E baseline owner is unavailable.');
  const now = new Date().toISOString();
  insertAuthE2ECompany(db, {
    companyId: crypto.randomUUID(),
    name: AUTH_E2E_BASELINE_COMPANY,
    ownerId: owner.id,
    now,
    track: false,
    recordInitialization: true,
  });
}

/** Reads the temporary company owned by the real first-run fixture user. */
export function readAuthE2EBaselineSnapshot(): {
  company: Record<string, unknown>;
  client: Record<string, unknown>;
  revision: number;
  owner: { id: string; email: string; role: string; status: string };
  administrator: { id: string; email: string; memberships: number };
  initializationHistory: number;
} {
  const db = openAuthE2EDatabase();
  try {
    const baselineRows = db
      .prepare(
        `SELECT companies.*
         FROM companies
         JOIN memberships ON memberships.scope_id = companies.id
         JOIN users ON users.id = memberships.user_id
         WHERE companies.name = ? AND users.email = ? AND memberships.role = 'owner' AND memberships.status = 'active'`,
      )
      .all(AUTH_E2E_BASELINE_COMPANY, AUTH_E2E_BASELINE_OWNER) as Array<Record<string, unknown>>;
    if (baselineRows.length > 1)
      throw new Error('Multiple retained Auth E2E baseline companies were found.');
    const company = baselineRows[0];
    if (!company) throw new Error('The retained Auth E2E baseline company is unavailable.');
    if (typeof company.id !== 'string')
      throw new Error('The retained Auth E2E baseline company has no ID.');
    const client = db
      .prepare('SELECT * FROM clients WHERE company_id = ? AND builtin = 1')
      .get(company.id) as Record<string, unknown> | undefined;
    const revision = db
      .prepare('SELECT revision FROM company_planning_revisions WHERE company_id = ?')
      .get(company.id) as { revision: number } | undefined;
    const owner = db
      .prepare(
        `SELECT users.id, users.email, memberships.role, memberships.status
         FROM memberships JOIN users ON users.id = memberships.user_id
         WHERE memberships.scope_id = ? AND users.email = 'baseline-owner@capacitylens.dev'`,
      )
      .get(company.id) as { id: string; email: string; role: string; status: string } | undefined;
    const administrator = db
      .prepare(
        `SELECT users.id, users.email, COUNT(memberships.id) AS memberships
         FROM users LEFT JOIN memberships ON memberships.user_id = users.id
         WHERE users.email = 'admin@admin.admin'
         GROUP BY users.id, users.email`,
      )
      .get() as { id: string; email: string; memberships: number } | undefined;
    const history = db
      .prepare(
        "SELECT COUNT(*) AS count FROM audit_entries WHERE company_id = ? AND action = 'company.initialized'",
      )
      .get(company.id) as { count: number } | undefined;
    if (
      !client ||
      !revision ||
      !owner ||
      !administrator ||
      administrator.memberships !== 0 ||
      !history ||
      history.count < 1
    )
      throw new Error('The retained Auth E2E baseline company is incomplete.');
    return {
      company,
      client,
      revision: revision.revision,
      owner,
      administrator,
      initializationHistory: history.count,
    };
  } finally {
    db.close();
  }
}

/** Waits until the auth server has completed its real first-run fixture setup. */
export async function waitForAuthE2EBaseline(): Promise<void> {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      readAuthE2EBaselineSnapshot();
      return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Auth E2E server did not finish baseline setup.', { cause: lastError });
}

/**
 * Sign up one user in an isolated request context and return its email and auto-signed-in session
 * cookie in one HTTP request. Use this when the test needs the cookie for API calls or browser
 * sign-in. When the test needs the user ID (for a PATCH/DELETE .../members/<userId> or a
 * toUserId transfer), use signUpUserWithId; it makes a second request to GET /api/auth/me.
 *
 * Each user gets a separate context because an APIRequestContext keeps a cookie jar. Product
 * sign-up creates a session in the same request, and its Set-Cookie header belongs only to this
 * fixture. This matches the server unit fixtures, which do not need a separate sign-in or email
 * step. Callers add a unique suffix to each email so a reused server
 * does not encounter duplicates.
 */
export async function signUpUser(
  email: string,
  name?: string,
): Promise<{ email: string; cookie: string }> {
  const ctx = await playwrightRequest.newContext();
  try {
    const cookie = await postSignUp(ctx, email, name);
    return { email, cookie };
  } finally {
    await ctx.dispose();
  }
}

/** Replaces the placeholder when needed, then creates this user's fixture company. */
export async function bootstrapOrg(
  request: APIRequestContext,
  cookie: string,
  name: string,
): Promise<string> {
  const identity = await request.get(`${AUTH_API}/api/auth/me`, {
    headers: { cookie, 'sec-fetch-site': 'same-origin' },
  });
  expect(identity.status(), 'fixture owner must have a real native session').toBe(200);
  const userId = ((await identity.json()) as { data?: { user?: { id?: unknown } } }).data?.user?.id;
  if (typeof userId !== 'string' || userId.length === 0)
    throw new Error('Auth E2E session has no user.');
  const companyName = name.trim();
  if (!companyName) throw new Error('Auth E2E fixture company requires a name.');

  const db = openAuthE2EDatabase();
  try {
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as
      { id: string } | undefined;
    if (!user) throw new Error('Auth E2E session user is absent from the fixture database.');
    db.exec('PRAGMA foreign_keys = ON');
    const foreignKeysEnabled = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    if (foreignKeysEnabled.foreign_keys !== 1)
      throw new Error('Auth E2E fixture creation requires SQLite foreign keys.');
    ensureAuthE2EFixtureCompanyTable(db);
    const companyId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      removeTemporaryBaselineCompany(db);
      insertAuthE2ECompany(db, {
        companyId,
        name: companyName,
        ownerId: userId,
        now,
        track: true,
        recordInitialization: false,
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return companyId;
  } finally {
    db.close();
  }
}

/** Removes scenario companies and restores one temporary company when the installation is empty. */
export function clearAuthE2ECompanies(): void {
  const db = openAuthE2EDatabase();
  try {
    db.exec('PRAGMA foreign_keys = ON');
    ensureAuthE2EFixtureCompanyTable(db);
    const rows = db.prepare('SELECT company_id FROM auth_e2e_fixture_companies').all() as Array<{
      company_id: string;
    }>;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const { company_id: companyId } of rows) {
        removeAuthE2ECompany(db, companyId);
        db.prepare('DELETE FROM auth_e2e_fixture_companies WHERE company_id = ?').run(companyId);
      }
      ensureTemporaryBaselineCompany(db);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

/** Seeds scenario data through an authenticated typed planning intent at the current revision. */
export async function sendPlanningIntent(
  request: APIRequestContext,
  cookie: string,
  companyId: string,
  intent: Record<string, unknown>,
): Promise<unknown> {
  const headers = { cookie, 'sec-fetch-site': 'same-origin' };
  const snapshot = await request.get(`${AUTH_API}/api/companies/${companyId}/planning`, {
    headers,
  });
  expect(snapshot.status(), `read planning revision for ${String(intent.operation)}`).toBe(200);
  const revision = ((await snapshot.json()) as { data?: { revision?: unknown } }).data?.revision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision))
    throw new Error('The fixture planning read did not return a revision.');
  const url = `${AUTH_API}/api/companies/${companyId}/planning/mutations`;
  const options = {
    headers: await masqueradeTokenHeaders(request, cookie),
    data: { mutationId: crypto.randomUUID(), baseRevision: revision, intent },
  };
  const response = await request.post(url, options);
  expect(
    response.status(),
    `seed planning intent ${String(intent.operation)}: ${await response.text()}`,
  ).toBe(200);
  return (await response.json()).data;
}

/** Creates a fully specified person through the planning mutation route for browser scenarios. */
export async function createTestPerson(
  request: APIRequestContext,
  cookie: string,
  companyId: string,
  person: { id: string; name: string; jobTitle: string; color?: string; avatarUrl?: string | null },
): Promise<void> {
  await sendPlanningIntent(request, cookie, companyId, {
    operation: 'resource.create',
    id: person.id,
    fields: {
      kind: 'person',
      name: person.name,
      jobTitle: person.jobTitle,
      avatarUrl: person.avatarUrl ?? null,
      disciplineId: null,
      employmentType: 'permanent',
      engagement: 'studio',
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      projectId: null,
      color: person.color ?? '#76a5e7',
      isFavourite: null,
      firstAvailableDate: null,
      lastAvailableDate: null,
    },
  });
}

/**
 * Sign up one user and also resolve its user ID (a second request, `GET /api/auth/me`, on top of
 * the sign-up). Use this only when a test needs the ID. Other tests should use the cheaper
 * `signUpUser` helper above. See its TSDoc for the isolated-context rationale.
 */
export async function signUpUserWithId(
  email: string,
  name?: string,
): Promise<{ email: string; cookie: string; userId: string }> {
  const ctx = await playwrightRequest.newContext();
  try {
    const cookie = await postSignUp(ctx, email, name);
    const me = await ctx.get(`${AUTH_API}/api/auth/me`, { headers: { cookie } });
    const userId = (await me.json()).data.user.id as string;
    return { email, cookie, userId };
  } finally {
    await ctx.dispose();
  }
}

/**
 * Issues an operator invitation against the auth E2E server's database and returns its acceptance
 * link, which the operator command prints instead of emailing. Keep the settings aligned with the
 * auth flavour in `apps/backend/scripts/e2e-server.mjs`. When `companyId` is given, the invitation
 * names that company.
 * @throws When the command fails or prints no link.
 */
export function printTestInvitation(
  email: string,
  role: 'admin' | 'editor' | 'viewer',
  companyId?: string,
): string {
  return printOperatorLink(
    [
      'account-kit:invite',
      email,
      `--role=${role}`,
      ...(companyId === undefined ? [] : [`--scope=${companyId}`]),
      '--print',
    ],
    'invitation',
  );
}

/** Provisions a reset link through Account Kit's operator API; returns its path. */
export function printTestResetLink(email: string): string {
  assertAuthE2EFixturePath(AUTH_E2E_DATABASE);
  const result = spawnSync(
    process.execPath,
    ['--import=@poppinss/ts-exec', 'scripts/e2e-reset-link.mjs', email],
    {
      cwd: BACKEND_DIRECTORY,
      encoding: 'utf8',
      timeout: 30_000,
      env: operatorFixtureEnvironment(),
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(`Auth E2E reset-link fixture failed (${result.status ?? 'spawn'}).`);
  const url = /"url":"([^"]+)"/.exec(result.stdout)?.[1];
  if (!url) throw new Error('The auth E2E reset-link fixture returned no link.');
  return new URL(url).pathname;
}

function printOperatorLink(args: string[], label: string): string {
  assertAuthE2EFixturePath(AUTH_E2E_DATABASE);
  const result = spawnSync(process.execPath, ['ace.js', ...args], {
    cwd: BACKEND_DIRECTORY,
    encoding: 'utf8',
    timeout: 30_000,
    env: operatorFixtureEnvironment(),
  });
  if (result.error || result.status !== 0)
    throw new Error(`Operator ${label} fixture failed (${result.status ?? 'spawn'}).`);
  const link = /"url":"([^"]+)"/.exec(result.stdout)?.[1];
  if (!link) throw new Error(`The operator ${label} command printed no link.`);
  return new URL(link).pathname;
}

function operatorFixtureEnvironment(): NodeJS.ProcessEnv {
  const portLane = ports();
  return {
    ...process.env,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: String(portLane.authApi),
    LOG_LEVEL: 'error',
    APP_KEY: 'capacitylens-e2e-key-0123456789abcdef',
    APP_URL: `http://127.0.0.1:${portLane.authApi}`,
    CAPACITYLENS_DB: '.auth-e2e.db',
    CAPACITYLENS_ALLOW_OPEN_SIGN_UP: '1',
    CAPACITYLENS_CREATE_ADMIN_ADMIN: 'false',
    CAPACITYLENS_PUBLIC_URL: `http://localhost:${portLane.authApi}`,
  };
}
