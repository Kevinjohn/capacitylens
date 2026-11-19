import { test } from '@japa/runner';
import type { HttpContext } from '@adonisjs/core/http';
import { freshDatabase } from '../../helpers/fresh_database.js';
import db from '@adonisjs/lucid/services/db';
import logger from '@adonisjs/core/services/logger';
import type { ResolvedContext } from '@kevinjohn/adonisjs-masquerade';
import { MasqueradeError } from '@kevinjohn/adonisjs-masquerade';
import { resetState } from '#tests/helpers/state_fixture';
import { createFixtureCompanyForOwner } from '../../helpers/authenticated_data_fixture.js';
import { signIn, signUpAndIn } from '../../helpers/identities.js';
import { masqueradeAdmission } from '../../helpers/masquerade_admission.js';
import app from '@adonisjs/core/services/app';
import { pruneViewAs } from '#services/storage_maintenance';
import { masqueradeService } from '#services/auth/masquerade';

const password = 'batman-secret-2026';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function asSession<
  T extends {
    setup(callback: (request: T) => void): T;
    withCookie(name: string, value: string): T;
    header(name: string, value: string): T;
  },
>(request: T, cookie: string, context?: string): T {
  return request.setup((prepared) => {
    prepared.withCookie('adonis-session', cookie);
    if (context) prepared.header('X-Masquerade-Context', context);
  });
}

async function contextToken(client: any, cookie: string) {
  const response = await asSession(client.get('/api/masquerade'), cookie).send();
  response.assertStatus(200);
  const token = response.body()?.contextToken;
  if (typeof token !== 'string') throw new Error('Masquerade context token was not returned.');
  return token;
}

async function startView(client: any, cookie: string, targetUserId: string) {
  const token = await contextToken(client, cookie);
  return asSession(
    client.post('/api/companies/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
    cookie,
    token
  )
    .json({ targetUserId })
    .send();
}

async function fixture(client: any, targetRole: 'viewer' | 'editor' | 'admin' = 'viewer') {
  const owner = await signUpAndIn(client, {
    email: 'bruce.wayne@wayne.example',
    password,
    name: 'Bruce Wayne',
  });
  owner.assertStatus(200);
  const cookie = owner.cookie('adonis-session')!.value;
  const ownerId = String((owner.body() as { user: { id: string } }).user.id);
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', 'a-studio');
  const targetId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.table('users').insert({
    id: targetId,
    email: 'clark.kent@wayne.example',
    display_name: 'Clark Kent',
    email_verified_at: new Date().toISOString(),
    password: null,
    created_at: now,
    updated_at: now,
  });
  await db.table('memberships').insert({
    scope_id: 'a-studio',
    user_id: targetId,
    role: targetRole,
    status: 'active',
    created_at: now,
    updated_at: now,
  });
  return { cookie, ownerId, targetId };
}

/** `fixture` with the signed-in viewer as an Admin under a separate company Owner, Diana Prince. */
async function adminFixture(client: any, targetRole: 'viewer' | 'editor' | 'admin' = 'editor') {
  const { cookie, ownerId: adminId, targetId } = await fixture(client, targetRole);
  const companyOwnerId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.table('users').insert({
    id: companyOwnerId,
    email: 'diana.prince@themyscira.example',
    display_name: 'Diana Prince',
    email_verified_at: now,
    password: null,
    created_at: now,
    updated_at: now,
  });
  await db.table('memberships').insert({
    scope_id: 'a-studio',
    user_id: companyOwnerId,
    role: 'owner',
    status: 'active',
    created_at: now,
    updated_at: now,
  });
  await db
    .from('memberships')
    .where({ scope_id: 'a-studio', user_id: adminId })
    .update({ role: 'admin' });
  return { cookie, adminId, companyOwnerId, targetId };
}

/** Makes the target the Owner of a-studio and the former Owner an Admin, as a transfer would. */
async function promoteToOwner(targetId: string, formerOwnerId: string) {
  await db
    .from('memberships')
    .where({ scope_id: 'a-studio', user_id: formerOwnerId })
    .update({ role: 'admin' });
  await db
    .from('memberships')
    .where({ scope_id: 'a-studio', user_id: targetId })
    .update({ role: 'owner' });
}

const privateClientName = 'Wayne Confidential Client';

/** A private a-studio client whose real name only an effective Owner receives. */
async function insertPrivateClient() {
  const now = new Date().toISOString();
  await db.table('clients').insert({
    id: crypto.randomUUID(),
    company_id: 'a-studio',
    name: privateClientName,
    code_name: 'Nightwing',
    color: '#123456',
    is_private: 'true',
    created_at: now,
    updated_at: now,
  });
}

async function endView(client: any, cookie: string) {
  const token = await contextToken(client, cookie);
  const ended = await asSession(
    client.delete('/api/masquerade').header('sec-fetch-site', 'same-origin'),
    cookie,
    token
  )
    .json({ token, reason: 'explicit' })
    .send();
  ended.assertStatus(200);
}

test.group('native read-only masquerade', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await db.from('account_admissions').delete();
    await db.from('account_invitations').delete();
    await db.from('adonis_sessions').delete();
    await db.from('memberships').delete();
    await db.from('users').delete();
  });

  test('requires the current context for idle writes and refuses writes in view mode', async ({
    client,
    assert,
  }) => {
    const { cookie, targetId } = await fixture(client);
    const missing = await asSession(
      client.post('/api/companies/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ targetUserId: targetId })
      .send();
    missing.assertStatus(428);
    assert.equal((missing.body() as { code: string }).code, 'MASQUERADE_CONTEXT_REQUIRED');

    const idleToken = await contextToken(client, cookie);
    const stale = await asSession(
      client.post('/api/companies/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie,
      '0.00000000000000000000000000000000'
    )
      .json({ targetUserId: targetId })
      .send();
    stale.assertStatus(409);
    assert.equal((stale.body() as { code: string }).code, 'MASQUERADE_CONTEXT_CHANGED');

    const started = await asSession(
      client.post('/api/companies/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie,
      idleToken
    )
      .json({ targetUserId: targetId })
      .send();
    started.assertStatus(200);
    const mode = started.body() as { contextToken: string };
    const capturedIdleStart = await asSession(
      client.post('/api/companies/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie,
      idleToken
    )
      .json({ targetUserId: targetId })
      .send();
    capturedIdleStart.assertStatus(409);
    assert.equal((capturedIdleStart.body() as { code: string }).code, 'MASQUERADE_CONTEXT_CHANGED');
    const write = await asSession(
      client.put('/api/companies/a-studio/getting-started').header('sec-fetch-site', 'same-origin'),
      cookie,
      mode.contextToken
    )
      .json({})
      .send();
    write.assertStatus(403);
    assert.equal((write.body() as { code: string }).code, 'MASQUERADE_READ_ONLY');
  });

  for (const { label, role, canSeeTimeOffNote } of [
    { label: 'an Editor', role: 'editor', canSeeTimeOffNote: false },
    { label: 'an Admin', role: 'admin', canSeeTimeOffNote: true },
  ] as const) {
    test(`sends only the read key and the target flags while viewing ${label}`, async ({
      client,
      assert,
    }) => {
      const { cookie, targetId } = await fixture(client, role);
      const started = await startView(client, cookie, targetId);
      started.assertStatus(200);
      const grantOf = (body: Record<string, unknown>) => ({
        effectiveRole: body.effectiveRole,
        permissions: body.permissions,
        canSeePrivateNames: body.canSeePrivateNames,
        canSeeTimeOffNote: body.canSeeTimeOffNote,
      });
      const readOnly = {
        effectiveRole: role,
        permissions: ['planning:read'],
        canSeePrivateNames: false,
        canSeeTimeOffNote,
      };
      assert.deepEqual(grantOf(started.body()), readOnly);
      const status = await asSession(
        client.get('/api/masquerade?companyId=a-studio'),
        cookie
      ).send();
      status.assertStatus(200);
      assert.isTrue(status.body().active);
      assert.deepEqual(grantOf(status.body()), readOnly);
    });
  }

  test('rejects planning reads carrying a context from before a remote mode change', async ({
    client,
    assert,
  }) => {
    const { cookie, targetId } = await fixture(client);
    const secondSession = await signIn(client, 'bruce.wayne@wayne.example', password);
    const idleToken = await contextToken(client, cookie);

    const started = await startView(client, secondSession.cookie, targetId);
    started.assertStatus(200);
    const activeToken = (started.body() as { contextToken: string }).contextToken;

    const staleIdleRead = await asSession(
      client.get('/api/companies/a-studio/planning'),
      cookie,
      idleToken
    ).send();
    staleIdleRead.assertStatus(409);
    assert.deepEqual(staleIdleRead.body(), {
      error: 'Masquerade context changed.',
      code: 'MASQUERADE_CONTEXT_CHANGED',
    });

    const stopped = await asSession(
      client.delete('/api/masquerade').header('sec-fetch-site', 'same-origin'),
      secondSession.cookie,
      activeToken
    )
      .json({ token: activeToken, reason: 'explicit' })
      .send();
    stopped.assertStatus(200);

    const staleActiveRead = await asSession(
      client.get('/api/companies/a-studio/planning'),
      cookie,
      activeToken
    ).send();
    staleActiveRead.assertStatus(409);
    assert.deepEqual(staleActiveRead.body(), {
      error: 'Masquerade context changed.',
      code: 'MASQUERADE_CONTEXT_CHANGED',
    });
  });

  test('returns a flat product error when a package storage error escapes middleware', async ({
    client,
    assert,
  }) => {
    const { cookie } = await fixture(client);
    const service = await masqueradeAdmission();
    const serviceWithTestFailure = service as unknown as {
      resolve(request: HttpContext): Promise<ResolvedContext>;
    };
    const originalResolve = service.resolve.bind(service);
    const failure = new MasqueradeError('E_MASQUERADE_UNAVAILABLE');
    serviceWithTestFailure.resolve = async () => {
      throw failure;
    };
    try {
      const response = await asSession(
        client.get('/api/companies/a-studio/planning'),
        cookie
      ).send();
      response.assertStatus(503);
      assert.deepEqual(response.body(), {
        error: 'Masquerade is unavailable.',
        code: 'MASQUERADE_UNAVAILABLE',
      });
    } finally {
      serviceWithTestFailure.resolve = originalResolve;
    }
  });

  test('keeps a captured idle actor for writes admitted before a concurrent start', async ({
    client,
    assert,
  }) => {
    const { cookie, targetId } = await fixture(client);
    const idleToken = await contextToken(client, cookie);
    const service = await masqueradeAdmission();
    const serviceWithTestGate = service as unknown as {
      resolve(request: HttpContext): Promise<ResolvedContext>;
    };
    const originalResolve = service.resolve.bind(service);
    const admitted = deferred();
    const release = deferred();
    serviceWithTestGate.resolve = async (request) => {
      const resolved = await originalResolve(request);
      if (request.request.header('x-test-admission-pause') === 'idle') {
        admitted.resolve();
        await release.promise;
      }
      return resolved;
    };

    try {
      const normalWrite = asSession(
        client
          .put('/api/companies/a-studio/getting-started')
          .header('sec-fetch-site', 'same-origin')
          .header('x-test-admission-pause', 'idle'),
        cookie,
        idleToken
      )
        .json({ dismissed: true })
        .send();
      await admitted.promise;
      const started = await startView(client, cookie, targetId);
      started.assertStatus(200);
      release.resolve();
      const saved = await normalWrite;
      saved.assertStatus(200);
      assert.isDefined(
        await db.from('account_getting_started_dismissals').where('company_id', 'a-studio').first()
      );
      const status = await asSession(client.get('/api/masquerade'), cookie).send();
      status.assertStatus(200);
      const activeToken = (status.body() as { contextToken: string }).contextToken;
      const ended = await asSession(
        client.delete('/api/masquerade').header('sec-fetch-site', 'same-origin'),
        cookie,
        activeToken
      )
        .json({ token: activeToken, reason: 'explicit' })
        .send();
      ended.assertStatus(200);
    } finally {
      release.resolve();
      serviceWithTestGate.resolve = originalResolve;
    }
  });

  test('keeps a captured active projection read-only after a concurrent stop', async ({
    client,
    assert,
  }) => {
    const { cookie: sessionCookie, targetId } = await fixture(client);
    const started = await startView(client, sessionCookie, targetId);
    started.assertStatus(200);
    const activeToken = (started.body() as { contextToken: string }).contextToken;
    const service = await masqueradeAdmission();
    const serviceWithTestGate = service as unknown as {
      resolve(request: HttpContext): Promise<ResolvedContext>;
    };
    const originalResolve = service.resolve.bind(service);
    const admitted = deferred();
    const release = deferred();
    serviceWithTestGate.resolve = async (request) => {
      const resolved = await originalResolve(request);
      if (request.request.header('x-test-admission-pause') === 'active') {
        admitted.resolve();
        await release.promise;
      }
      return resolved;
    };

    try {
      const pendingWrite = asSession(
        client
          .put('/api/companies/a-studio/getting-started')
          .header('sec-fetch-site', 'same-origin')
          .header('x-test-admission-pause', 'active'),
        sessionCookie,
        activeToken
      )
        .json({ dismissed: true })
        .send();
      await admitted.promise;
      const stopped = await asSession(
        client.delete('/api/masquerade').header('sec-fetch-site', 'same-origin'),
        sessionCookie,
        activeToken
      )
        .json({ token: activeToken, reason: 'explicit' })
        .send();
      stopped.assertStatus(200);
      release.resolve();
      const refused = await pendingWrite;
      refused.assertStatus(403);
      assert.equal((refused.body() as { code: string }).code, 'MASQUERADE_READ_ONLY');
      assert.isNull(
        await db.from('account_getting_started_dismissals').where('company_id', 'a-studio').first()
      );
    } finally {
      release.resolve();
      serviceWithTestGate.resolve = originalResolve;
    }
  });

  test('uses the target role for reads, real actor for audit, and explicit end restores access', async ({
    client,
    assert,
  }) => {
    const { cookie, ownerId, targetId } = await fixture(client);
    const privateClientId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.table('clients').insert({
      id: privateClientId,
      company_id: 'a-studio',
      name: 'Wayne Confidential Client',
      code_name: 'Nightwing',
      color: '#123456',
      is_private: 'true',
      created_at: now,
      updated_at: now,
    });
    const ownerRead = await asSession(client.get('/api/state?companyId=a-studio'), cookie).send();
    ownerRead.assertStatus(200);
    assert.include(JSON.stringify(ownerRead.body()), 'Wayne Confidential Client');
    const started = await startView(client, cookie, targetId);
    started.assertStatus(200);
    const state = started.body() as {
      companyId: string;
      targetUserId: string;
      effectiveRole: string;
      token: string;
      contextToken: string;
      expiresAt: string;
    };
    assert.equal(state.companyId, 'a-studio');
    assert.equal(state.targetUserId, targetId);
    assert.equal(state.effectiveRole, 'viewer');
    assert.equal(state.contextToken, state.token);
    assert.isAbove(Date.parse(state.expiresAt), Date.now());
    const projected = await asSession(
      client.get('/api/companies/a-studio/planning'),
      cookie
    ).send();
    projected.assertStatus(200);
    const status = await asSession(client.get('/api/masquerade'), cookie).send();
    status.assertStatus(200);
    const active = status.body() as {
      active: boolean;
      principal: { id: string; email: string };
      contextToken: string;
      expiresAt: string;
    };
    assert.isTrue(active.active);
    assert.equal(active.principal.id, ownerId);
    assert.equal(active.principal.email, 'bruce.wayne@wayne.example');
    assert.equal(active.contextToken, state.contextToken);
    assert.equal(active.expiresAt, state.expiresAt);
    const secondSession = await signIn(client, 'bruce.wayne@wayne.example', password);
    const secondStatus = await asSession(
      client.get('/api/masquerade'),
      secondSession.cookie
    ).send();
    secondStatus.assertStatus(200);
    assert.isTrue((secondStatus.body() as { active: boolean }).active);
    assert.equal(
      (secondStatus.body() as { contextToken: string }).contextToken,
      state.contextToken
    );
    const secondProjected = await asSession(
      client.get('/api/companies/a-studio/planning'),
      secondSession.cookie
    ).send();
    secondProjected.assertStatus(200);
    const anonymiseAudits = await db.from('audit_entries').where('action', 'anonymise');
    const auditCount = anonymiseAudits.length;
    const deniedAnonymise = await asSession(
      client
        .post('/api/companies/a-studio/resources/unavailable/anonymise')
        .header('sec-fetch-site', 'same-origin'),
      cookie,
      state.contextToken
    )
      .json({})
      .send();
    deniedAnonymise.assertStatus(403);
    assert.lengthOf(await db.from('audit_entries').where('action', 'anonymise'), auditCount);
    const read = await asSession(client.get('/api/state?companyId=a-studio'), cookie).send();
    read.assertStatus(200);
    assert.notInclude(JSON.stringify(read.body()), 'Wayne Confidential Client');
    assert.include(JSON.stringify(read.body()), 'Nightwing');
    const inactiveExport = await asSession(
      client.get('/api/state?companyId=a-studio&includeInactive=1'),
      cookie
    ).send();
    inactiveExport.assertStatus(403);
    const foreign = await asSession(client.get('/api/state?companyId=a-loft'), cookie).send();
    foreign.assertStatus(403);
    const account = await asSession(client.get('/api/companies'), cookie).send();
    account.assertStatus(403);
    assert.equal((account.body() as unknown as { code: string }).code, 'MASQUERADE_READ_ONLY');
    const audit = await db
      .from('masquerade_events')
      .where({ kind: 'started', actor_id: ownerId })
      .first();
    assert.equal(audit.actor_id, ownerId);

    const ended = await asSession(
      client.delete('/api/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie,
      state.contextToken
    )
      .json({ token: state.token, reason: 'explicit' })
      .send();
    ended.assertStatus(200);
    assert.isFalse((ended.body() as { active: boolean }).active);
    const capturedActiveStart = await asSession(
      client.post('/api/companies/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie,
      state.contextToken
    )
      .json({ targetUserId: targetId })
      .send();
    capturedActiveStart.assertStatus(409);
    assert.equal(
      (capturedActiveStart.body() as { code: string }).code,
      'MASQUERADE_CONTEXT_CHANGED'
    );
    const after = await asSession(client.get('/api/companies'), cookie).send();
    after.assertStatus(200);
    const endAudit = await db
      .from('masquerade_events')
      .where({ kind: 'stopped', actor_id: ownerId })
      .first();
    assert.equal(endAudit.actor_id, ownerId);
  });

  test('refuses unsafe and auth routes while viewing, and answers unknown routes with 404', async ({
    client,
    assert,
  }) => {
    const { cookie, targetId } = await fixture(client, 'editor');
    const started = await startView(client, cookie, targetId);
    started.assertStatus(200);
    assert.equal((started.body() as { effectiveRole: string }).effectiveRole, 'editor');
    const editorRead = await asSession(client.get('/api/state?companyId=a-studio'), cookie).send();
    editorRead.assertStatus(200);
    const examples = [
      asSession(
        client
          .put('/api/companies/a-studio/getting-started')
          .header('sec-fetch-site', 'same-origin'),
        cookie,
        (started.body() as { contextToken: string }).contextToken
      ).json({}),
      asSession(
        client.post('/api/no-such-route').header('sec-fetch-site', 'same-origin'),
        cookie,
        (started.body() as { contextToken: string }).contextToken
      ).json({}),
      asSession(
        client.post('/api/masquerade').header('sec-fetch-site', 'same-origin'),
        cookie,
        (started.body() as { contextToken: string }).contextToken
      ).json({}),
      asSession(
        client.post('/no-such-route').header('sec-fetch-site', 'same-origin'),
        cookie,
        (started.body() as { contextToken: string }).contextToken
      ).json({}),
      asSession(
        client.post<string>('/api/auth/sign-in').header('sec-fetch-site', 'same-origin'),
        cookie,
        (started.body() as { contextToken: string }).contextToken
      ).json({}),
      asSession(
        client.post('/api/auth/register').header('sec-fetch-site', 'same-origin'),
        cookie,
        (started.body() as { contextToken: string }).contextToken
      ).json({}),
      asSession(client.get('/api/auth/me'), cookie),
      asSession(client.get('/api/companies/a-studio/members'), cookie),
      asSession(client.get('/api/diagnostics'), cookie),
    ];
    // Route policy runs after route matching, so a write to a path with no route is a 404 (#1865).
    const expectedStatuses = [403, 404, 404, 404, 403, 404, 403, 403, 403];
    for (const [index, request] of examples.entries()) {
      const response = await request.send();
      response.assertStatus(expectedStatuses[index]!);
      if (expectedStatuses[index] === 403)
        assert.equal((response.body() as { code: string }).code, 'MASQUERADE_READ_ONLY');
    }
    const malformed = await asSession(
      client
        .put('/api/companies/a-studio/getting-started')
        .header('sec-fetch-site', 'same-origin')
        .header('content-type', 'application/json'),
      cookie,
      (started.body() as { contextToken: string }).contextToken
    ).setup((request) => {
      request.request.send('{');
    });
    // The body parser runs before route policy, so a malformed write is refused as malformed.
    malformed.assertStatus(400);
    assert.notExists(
      await db.from('account_getting_started_dismissals').where('company_id', 'a-studio').first()
    );
    const signedOut = await asSession(
      client.post('/api/auth/sign-out').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({})
      .send();
    signedOut.assertStatus(200);
    assert.equal(
      await db
        .from('masquerade_modes')
        .where({
          actor_id: (started.body() as { principal: { id: string } }).principal?.id,
          state: 'active',
        })
        .count('* as total')
        .first()
        .then((row) => row?.total),
      1
    );
  });

  test('reports the active view where it holds when another company is requested', async ({
    client,
    assert,
  }) => {
    const { cookie, ownerId, targetId } = await fixture(client);
    await createFixtureCompanyForOwner(ownerId, 'Stark Industries', 'a-loft');
    const started = await startView(client, cookie, targetId);
    started.assertStatus(200);
    const elsewhere = await asSession(
      client.get('/api/masquerade?companyId=a-loft'),
      cookie
    ).send();
    elsewhere.assertStatus(200);
    const body = elsewhere.body() as {
      active: boolean;
      companyId: string;
      targetUserId: string;
      contextToken: string;
    };
    assert.isTrue(body.active);
    assert.equal(body.companyId, 'a-studio');
    assert.equal(body.targetUserId, targetId);
    assert.equal(body.contextToken, (started.body() as { contextToken: string }).contextToken);
  });

  test('rejects self, inactive target, and malformed session authority', async ({ client }) => {
    const { cookie, ownerId, targetId } = await fixture(client);
    const self = await startView(client, cookie, ownerId);
    self.assertStatus(400);
    await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: targetId })
      .update({ status: 'suspended' });
    const inactive = await startView(client, cookie, targetId);
    inactive.assertStatus(403);
    await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: targetId })
      .update({ status: 'active' });
    const now = new Date().toISOString();
    await db.table('accounts').insert({
      id: 'a-loft',
      name: 'Stark Industries',
      color: '#123456',
      created_at: now,
      updated_at: now,
    });
    await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: targetId })
      .update({ scope_id: 'a-loft' });
    const foreign = await startView(client, cookie, targetId);
    foreign.assertStatus(403);
    await db
      .from('memberships')
      .where({ scope_id: 'a-loft', user_id: targetId })
      .update({ scope_id: 'a-studio' });
    await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: ownerId })
      .update({ role: 'viewer' });
    const nonAdmin = await startView(client, cookie, targetId);
    nonAdmin.assertStatus(403);
    await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: ownerId })
      .update({ role: 'owner' });
    await db.from('account_sessions').where('user_id', ownerId).delete();
    const revoked = await asSession(
      client.post('/api/companies/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ targetUserId: targetId })
      .send();
    revoked.assertStatus(401);
  });

  test('ends an open view as soon as the viewer loses the role that permits it', async ({
    client,
    assert,
  }) => {
    const { cookie, ownerId, targetId } = await fixture(client, 'editor');
    const started = await startView(client, cookie, targetId);
    started.assertStatus(200);
    await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: ownerId })
      .update({ role: 'viewer' });
    const read = await asSession(client.get('/api/state?companyId=a-studio'), cookie).send();
    read.assertStatus(409);
    const status = await asSession(client.get('/api/masquerade'), cookie).send();
    status.assertStatus(200);
    const current = status.body() as { active: boolean; contextToken: string };
    assert.isFalse(current.active);
    const ended = await asSession(
      client.delete('/api/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie,
      current.contextToken
    )
      .json({ token: current.contextToken, reason: 'explicit' })
      .send();
    ended.assertStatus(200);
  });

  test('allows a valid Owner session older than the fresh-action window to start viewing', async ({
    client,
    assert,
  }) => {
    const { cookie, ownerId, targetId } = await fixture(client);
    await db
      .from('account_sessions')
      .where('user_id', ownerId)
      .update({ created_at: new Date(Date.now() - 16 * 60_000).toISOString() });
    const started = await startView(client, cookie, targetId);
    started.assertStatus(200);
    assert.equal((started.body() as { targetUserId: string }).targetUserId, targetId);
  });

  test('the scheduled prune ends an expired mode and deletes events past retention', async ({
    client,
    assert,
  }) => {
    const { cookie, ownerId, targetId } = await fixture(client);
    const started = await startView(client, cookie, targetId);
    started.assertStatus(200);
    const now = Date.now();
    const owner = { authority_namespace: 'capacitylens', actor_id: ownerId };
    await db
      .from('masquerade_modes')
      .where(owner)
      .update({
        started_at: new Date(now - 31 * 60_000).toISOString(),
        expires_at: new Date(now - 16 * 60_000).toISOString(),
      });
    // The start event is aged past the 365-day retention; the expiry event written by this pass is not.
    await db
      .from('masquerade_events')
      .where({ actor_id: ownerId, kind: 'started' })
      .update({ at: new Date(now - 366 * 24 * 60 * 60_000).toISOString() });

    await pruneViewAs(app);

    const mode = await db.from('masquerade_modes').where(owner).firstOrFail();
    assert.notEqual(mode.state, 'active');
    const events = await db.from('masquerade_events').where('actor_id', ownerId);
    assert.deepEqual(
      events.map((event) => event.kind),
      ['expired']
    );
  });

  test('expires package mode on status and rejects the pre-expiry context token', async ({
    client,
    assert,
  }) => {
    const { cookie, ownerId, targetId } = await fixture(client);
    const started = await startView(client, cookie, targetId);
    started.assertStatus(200);
    const token = (started.body() as { contextToken: string }).contextToken;
    const now = Date.now();
    await db
      .from('masquerade_modes')
      .where({ authority_namespace: 'capacitylens', actor_id: ownerId })
      .update({
        started_at: new Date(now - 31 * 60_000).toISOString(),
        expires_at: new Date(now - 16 * 60_000).toISOString(),
      });

    const status = await asSession(client.get('/api/masquerade'), cookie).send();
    status.assertStatus(200);
    assert.isFalse((status.body() as { active: boolean }).active);
    assert.lengthOf(
      await db.from('masquerade_events').where({ actor_id: ownerId, kind: 'expired' }),
      1
    );
    assert.notEqual((status.body() as { contextToken: string }).contextToken, token);
    const staleWrite = await asSession(
      client.post('/api/companies/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie,
      token
    )
      .json({ targetUserId: targetId })
      .send();
    staleWrite.assertStatus(409);
    assert.equal((staleWrite.body() as { code: string }).code, 'MASQUERADE_CONTEXT_CHANGED');
  });

  test('invalidates target context after credential change or identity removal', async ({
    client,
    assert,
  }) => {
    const { cookie, ownerId, targetId } = await fixture(client);
    const started = await startView(client, cookie, targetId);
    started.assertStatus(200);
    await db
      .from('users')
      .where('id', targetId)
      .update({ credentials_changed_at: new Date().toISOString() });
    const credentialStatus = await asSession(client.get('/api/masquerade'), cookie).send();
    credentialStatus.assertStatus(200);
    assert.isFalse((credentialStatus.body() as { active: boolean }).active);

    const restarted = await startView(client, cookie, targetId);
    restarted.assertStatus(200);
    await db.from('memberships').where('user_id', targetId).delete();
    await db.from('users').where('id', targetId).delete();
    const status = await asSession(client.get('/api/masquerade'), cookie).send();
    status.assertStatus(200);
    assert.isFalse((status.body() as { active: boolean }).active);
    assert.lengthOf(
      await db.from('masquerade_events').where({ actor_id: ownerId, kind: 'invalidated' }),
      2
    );
  });

  test('serializes concurrent starts and stops across the identity', async ({ client, assert }) => {
    const { cookie, ownerId, targetId } = await fixture(client);
    const secondTargetId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.table('users').insert({
      id: secondTargetId,
      email: 'diana.prince@wayne.example',
      display_name: 'Diana Prince',
      email_verified_at: now,
      password: null,
      created_at: now,
      updated_at: now,
    });
    await db.table('memberships').insert({
      scope_id: 'a-studio',
      user_id: secondTargetId,
      role: 'viewer',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    const idleToken = await contextToken(client, cookie);
    const starts = await Promise.all(
      [targetId, secondTargetId].map((userId) =>
        asSession(
          client.post('/api/companies/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
          cookie,
          idleToken
        )
          .json({ targetUserId: userId })
          .send()
      )
    );
    assert.deepEqual(starts.map((response) => response.status()).sort(), [200, 409]);
    const active = starts.find((response) => response.status() === 200)!;
    const activeToken = (active.body() as { contextToken: string }).contextToken;
    const stops = await Promise.all(
      [0, 1].map(() =>
        asSession(
          client.delete('/api/masquerade').header('sec-fetch-site', 'same-origin'),
          cookie,
          activeToken
        )
          .json({ token: activeToken, reason: 'explicit' })
          .send()
      )
    );
    assert.deepEqual(stops.map((response) => response.status()).sort(), [200, 409]);
    const events = await db.from('masquerade_events').where({ actor_id: ownerId, kind: 'started' });
    assert.lengthOf(events, 1);
    const stoppedEvents = await db
      .from('masquerade_events')
      .where({ actor_id: ownerId, kind: 'stopped' });
    assert.lengthOf(stoppedEvents, 1);
  });

  test('rolls back the package mode transition when its event insert fails', async ({
    client,
    assert,
  }) => {
    const { cookie, ownerId: actorId, targetId } = await fixture(client);
    await db.rawQuery(
      "CREATE TRIGGER reject_masquerade_event BEFORE INSERT ON masquerade_events BEGIN SELECT RAISE(ABORT, 'fixture event insert failure'); END"
    );
    try {
      const response = await startView(client, cookie, targetId);
      response.assertStatus(503);
      assert.isNull(
        await db
          .from('masquerade_modes')
          .where({ authority_namespace: 'capacitylens', actor_id: actorId })
          .first()
      );
      assert.isEmpty(await db.from('masquerade_events').where('actor_id', actorId));
    } finally {
      await db.rawQuery('DROP TRIGGER reject_masquerade_event');
    }
  });

  test('keeps a committed transition successful when an observer throws', async ({
    client,
    assert,
  }) => {
    const { cookie, ownerId, targetId } = await fixture(client);
    const originalInfo = logger.info;
    try {
      logger.info = () => {
        throw new Error('fixture observer failure');
      };
      const response = await startView(client, cookie, targetId);
      response.assertStatus(200);
      assert.isDefined(
        await db
          .from('masquerade_modes')
          .where({ authority_namespace: 'capacitylens', actor_id: ownerId, state: 'active' })
          .first()
      );
      assert.lengthOf(
        await db.from('masquerade_events').where({ actor_id: ownerId, kind: 'started' }),
        1
      );
    } finally {
      logger.info = originalInfo;
    }
  });

  test('reports inactive for anonymous and revoked sessions without restoring data access', async ({
    client,
    assert,
  }) => {
    const anonymous = await client.get('/api/masquerade').send();
    anonymous.assertStatus(200);
    assert.deepEqual(anonymous.body(), { active: false, contextToken: null });
    const { cookie, targetId } = await fixture(client);
    const started = await startView(client, cookie, targetId);
    started.assertStatus(200);
    await db.from('account_sessions').delete();
    const revoked = await asSession(client.get('/api/masquerade'), cookie).send();
    revoked.assertStatus(200);
    assert.deepEqual(revoked.body(), { active: false, contextToken: null });
    const deniedRead = await asSession(client.get('/api/state?companyId=a-studio'), cookie).send();
    deniedRead.assertStatus(401);
    const anonymousStart = await client
      .post('/api/companies/a-studio/masquerade')
      .header('sec-fetch-site', 'same-origin')
      .json({ targetUserId: targetId })
      .send();
    anonymousStart.assertStatus(401);
    assert.deepEqual(anonymousStart.body(), {
      error: 'Sign-in required.',
      code: 'SIGN_IN_REQUIRED',
    });
  });

  test('view-as controls answer package refusals with the shared error codes', async ({
    client,
    assert,
  }) => {
    const { cookie, targetId } = await fixture(client);
    const outsiderId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.table('users').insert({
      id: outsiderId,
      email: 'diana.prince@themyscira.example',
      display_name: 'Diana Prince',
      email_verified_at: now,
      password: null,
      created_at: now,
      updated_at: now,
    });
    const outsider = await startView(client, cookie, outsiderId);
    outsider.assertStatus(403);
    assert.deepEqual(outsider.body(), {
      error: 'This action is not allowed.',
      code: 'AUTHORIZATION_DENIED',
    });

    const started = await startView(client, cookie, targetId);
    started.assertStatus(200);
    const again = await startView(client, cookie, targetId);
    again.assertStatus(409);
    assert.deepEqual(again.body(), {
      error: 'Masquerade is already active.',
      code: 'MASQUERADE_ACTIVE',
    });
    const activeToken = await contextToken(client, cookie);
    const ended = await asSession(
      client.delete('/api/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie,
      activeToken
    )
      .json({ token: activeToken, reason: 'explicit' })
      .send();
    ended.assertStatus(200);

    const service = await masqueradeService();
    const originalStart = service.start;
    try {
      for (const [code, status, body] of [
        [
          'E_MASQUERADE_UNAUTHENTICATED',
          401,
          { error: 'Sign-in required.', code: 'SIGN_IN_REQUIRED' },
        ],
        [
          'E_MASQUERADE_UNAVAILABLE',
          503,
          { error: 'Masquerade is unavailable.', code: 'MASQUERADE_UNAVAILABLE' },
        ],
      ] as const) {
        service.start = async () => {
          throw new MasqueradeError(code);
        };
        const refused = await startView(client, cookie, targetId);
        refused.assertStatus(status);
        assert.deepEqual(refused.body(), body);
      }
    } finally {
      service.start = originalStart;
    }
  });

  test('refuses an Admin a view as the Owner and creates no mode', async ({ client, assert }) => {
    const { cookie, companyOwnerId } = await adminFixture(client);
    const refused = await startView(client, cookie, companyOwnerId);
    refused.assertStatus(403);
    const status = await asSession(client.get('/api/masquerade?companyId=a-studio'), cookie).send();
    status.assertStatus(200);
    assert.isFalse((status.body() as { active: boolean }).active);
  });

  test('lets an Admin view as an Admin, Editor or Viewer', async ({ client, assert }) => {
    const { cookie, targetId } = await adminFixture(client, 'admin');
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      await db
        .from('memberships')
        .where({ scope_id: 'a-studio', user_id: targetId })
        .update({ role });
      const started = await startView(client, cookie, targetId);
      started.assertStatus(200);
      assert.equal((started.body() as { effectiveRole: string }).effectiveRole, role);
      const read = await asSession(client.get('/api/companies/a-studio/planning'), cookie).send();
      read.assertStatus(200);
      await endView(client, cookie);
    }
  });

  test("ends an Admin's view when the target is promoted to Owner", async ({ client, assert }) => {
    const { cookie, adminId, companyOwnerId, targetId } = await adminFixture(client);
    await insertPrivateClient();
    // The first refused read ends the mode, so each read gets its own view.
    for (const [index, path] of [
      '/api/companies/a-studio/planning',
      '/api/state?companyId=a-studio',
      '/api/companies/a-studio/export',
    ].entries()) {
      await db
        .from('memberships')
        .where({ scope_id: 'a-studio', user_id: companyOwnerId })
        .update({ role: 'owner' });
      await db
        .from('memberships')
        .where({ scope_id: 'a-studio', user_id: targetId })
        .update({ role: 'editor' });
      const started = await startView(client, cookie, targetId);
      started.assertStatus(200);
      await promoteToOwner(targetId, companyOwnerId);
      const read = await asSession(client.get(path), cookie).send();
      const ended = await db
        .from('masquerade_events')
        .where({ actor_id: adminId, kind: 'invalidated', outcome_code: 'policy_denied' });
      assert.lengthOf(ended, index + 1, path);
      read.assertStatus(409);
      assert.notInclude(read.text(), privateClientName, path);
      const status = await asSession(
        client.get('/api/masquerade?companyId=a-studio'),
        cookie
      ).send();
      status.assertStatus(200);
      const current = status.body() as { active: boolean; effectiveRole?: string };
      assert.isFalse(current.active, path);
      assert.notEqual(current.effectiveRole, 'owner', path);
    }
  });

  test('refuses a planning read admitted before the target was promoted above the Admin', async ({
    client,
    assert,
  }) => {
    const { cookie, companyOwnerId, targetId } = await adminFixture(client);
    await insertPrivateClient();
    const started = await startView(client, cookie, targetId);
    started.assertStatus(200);
    const service = await masqueradeAdmission();
    const serviceWithTestGate = service as unknown as {
      resolve(request: HttpContext): Promise<ResolvedContext>;
    };
    const originalResolve = service.resolve.bind(service);
    const admitted = deferred();
    const release = deferred();
    serviceWithTestGate.resolve = async (request) => {
      const resolved = await originalResolve(request);
      if (request.request.header('x-test-admission-pause') === 'promote') {
        admitted.resolve();
        await release.promise;
      }
      return resolved;
    };
    try {
      const pendingRead = asSession(
        client.get('/api/companies/a-studio/planning').header('x-test-admission-pause', 'promote'),
        cookie
      ).send();
      await admitted.promise;
      await promoteToOwner(targetId, companyOwnerId);
      release.resolve();
      const read = await pendingRead;
      read.assertStatus(403);
      assert.equal((read.body() as { code: string }).code, 'ACCOUNT_MEMBERSHIP_LOST');
      assert.notInclude(read.text(), privateClientName);
    } finally {
      release.resolve();
      serviceWithTestGate.resolve = originalResolve;
    }
  });

  test('refuses a state read in the company where the target outranks the Admin', async ({
    client,
    assert,
  }) => {
    const { cookie, adminId, companyOwnerId, targetId } = await adminFixture(client);
    await insertPrivateClient();
    await createFixtureCompanyForOwner(adminId, 'Stark Industries', 'a-tower');
    const now = new Date().toISOString();
    await db.table('memberships').insert({
      scope_id: 'a-tower',
      user_id: targetId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    const started = await startView(client, cookie, targetId);
    started.assertStatus(200);
    await promoteToOwner(targetId, companyOwnerId);
    // The query names no route company, so admission accepts the view through a-tower and only
    // the in-transaction check sees that the target outranks the Admin in a-studio.
    const read = await asSession(client.get('/api/state?companyId=a-studio'), cookie).send();
    read.assertStatus(403);
    assert.notInclude(read.text(), privateClientName);
  });

  test("reports an Admin's view only where the target does not outrank them", async ({
    client,
    assert,
  }) => {
    const { cookie, adminId, companyOwnerId, targetId } = await adminFixture(client);
    await createFixtureCompanyForOwner(adminId, 'Stark Industries', 'a-tower');
    const now = new Date().toISOString();
    await db.table('memberships').insert({
      scope_id: 'a-tower',
      user_id: targetId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    const started = await startView(client, cookie, targetId);
    started.assertStatus(200);
    await promoteToOwner(targetId, companyOwnerId);
    // a-studio sorts first, so the status search reaches it before a-tower.
    for (const path of ['/api/masquerade?companyId=a-studio', '/api/masquerade']) {
      const status = await asSession(client.get(path), cookie).send();
      status.assertStatus(200);
      assert.deepInclude(
        status.body(),
        { active: true, companyId: 'a-tower', effectiveRole: 'editor' },
        path
      );
    }
  });
});
