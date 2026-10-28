import { test } from '@japa/runner';
import type { HttpContext } from '@adonisjs/core/http';
import { freshDatabase } from '../../helpers/fresh_database.js';
import db from '@adonisjs/lucid/services/db';
import logger from '@adonisjs/core/services/logger';
import type { ResolvedContext } from 'adonisjs-masquerade';
import { MasqueradeError } from 'adonisjs-masquerade';
import { resetState } from '#services/state_repository';
import { createFixtureCompanyForOwner } from '../../helpers/authenticated_data_fixture.js';
import { signIn, signUpAndIn } from '../../helpers/identities.js';
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
    client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
    cookie,
    token
  )
    .json({ targetUserId })
    .send();
}

async function fixture(client: any, targetRole: 'viewer' | 'editor' = 'viewer') {
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
    id: crypto.randomUUID(),
    account_id: 'a-studio',
    user_id: targetId,
    role: targetRole,
    status: 'active',
    created_at: now,
    updated_at: now,
  });
  return { cookie, ownerId, targetId };
}

test.group('native read-only masquerade', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await db.from('account_admissions').delete();
    await db.from('account_invitations').delete();
    await db.from('adonis_sessions').delete();
    await db.from('users').delete();
  });

  test('requires the current context for idle writes and refuses writes in view mode', async ({
    client,
    assert,
  }) => {
    const { cookie, targetId } = await fixture(client);
    const missing = await asSession(
      client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ targetUserId: targetId })
      .send();
    missing.assertStatus(428);
    assert.equal((missing.body() as { code: string }).code, 'MASQUERADE_CONTEXT_REQUIRED');

    const idleToken = await contextToken(client, cookie);
    const stale = await asSession(
      client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie,
      '0.00000000000000000000000000000000'
    )
      .json({ targetUserId: targetId })
      .send();
    stale.assertStatus(409);
    assert.equal((stale.body() as { code: string }).code, 'MASQUERADE_CONTEXT_CHANGED');

    const started = await asSession(
      client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie,
      idleToken
    )
      .json({ targetUserId: targetId })
      .send();
    started.assertStatus(200);
    const mode = started.body() as { contextToken: string };
    const capturedIdleStart = await asSession(
      client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
      cookie,
      idleToken
    )
      .json({ targetUserId: targetId })
      .send();
    capturedIdleStart.assertStatus(409);
    assert.equal((capturedIdleStart.body() as { code: string }).code, 'MASQUERADE_CONTEXT_CHANGED');
    const write = await asSession(
      client.post('/api/no-such-route').header('sec-fetch-site', 'same-origin'),
      cookie,
      mode.contextToken
    )
      .json({})
      .send();
    write.assertStatus(403);
    assert.equal((write.body() as { code: string }).code, 'MASQUERADE_READ_ONLY');
  });

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
      client.get('/api/accounts/a-studio/planning'),
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
      client.get('/api/accounts/a-studio/planning'),
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
    const service = await masqueradeService();
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
        client.get('/api/accounts/a-studio/planning'),
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
    const { cookie, ownerId, targetId } = await fixture(client);
    const idleToken = await contextToken(client, cookie);
    const service = await masqueradeService();
    const serviceWithTestGate = service as unknown as {
      resolve(request: HttpContext): Promise<ResolvedContext>;
    };
    const originalResolve = service.resolve.bind(service);
    const bothAdmitted = deferred();
    const release = deferred();
    let admittedCount = 0;
    serviceWithTestGate.resolve = async (request) => {
      const resolved = await originalResolve(request);
      if (request.request.header('x-test-admission-pause') === 'idle') {
        admittedCount += 1;
        if (admittedCount === 2) bothAdmitted.resolve();
        await release.promise;
      }
      return resolved;
    };

    try {
      const normalWrite = asSession(
        client
          .put('/api/accounts/a-studio/getting-started')
          .header('sec-fetch-site', 'same-origin')
          .header('x-test-admission-pause', 'idle'),
        cookie,
        idleToken
      )
        .json({ dismissed: true })
        .send();
      const actionProofWrite = asSession(
        client
          .post('/api/auth/action-proof/password')
          .header('sec-fetch-site', 'same-origin')
          .header('x-test-admission-pause', 'idle'),
        cookie,
        idleToken
      )
        .json({
          action: 'anonymise',
          accountId: 'a-studio',
          intent: {},
          password,
        })
        .send();

      await bothAdmitted.promise;
      const started = await startView(client, cookie, targetId);
      started.assertStatus(200);
      release.resolve();
      const [saved, proof] = await Promise.all([normalWrite, actionProofWrite]);
      saved.assertStatus(200);
      proof.assertStatus(200);
      assert.isDefined(
        await db.from('account_getting_started_dismissals').where('account_id', 'a-studio').first()
      );
      assert.isDefined(
        await db
          .from('action_proofs')
          .where({ user_id: ownerId, account_id: 'a-studio', action: 'anonymise' })
          .first()
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
    const service = await masqueradeService();
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
          .put('/api/accounts/a-studio/getting-started')
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
        await db.from('account_getting_started_dismissals').where('account_id', 'a-studio').first()
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
      account_id: 'a-studio',
      name: 'Wayne Confidential Client',
      code_name: 'Nightwing',
      color: '#123456',
      is_private: 'true',
      created_at: now,
      updated_at: now,
    });
    const ownerRead = await asSession(client.get('/api/state?accountId=a-studio'), cookie).send();
    ownerRead.assertStatus(200);
    assert.include(JSON.stringify(ownerRead.body()), 'Wayne Confidential Client');
    const started = await startView(client, cookie, targetId);
    started.assertStatus(200);
    const state = started.body() as {
      accountId: string;
      targetUserId: string;
      effectiveRole: string;
      token: string;
      contextToken: string;
      expiresAt: string;
    };
    assert.equal(state.accountId, 'a-studio');
    assert.equal(state.targetUserId, targetId);
    assert.equal(state.effectiveRole, 'viewer');
    assert.equal(state.contextToken, state.token);
    assert.isAbove(Date.parse(state.expiresAt), Date.now());
    const projected = await asSession(client.get('/api/accounts/a-studio/planning'), cookie).send();
    projected.assertStatus(200);
    const status = await asSession(client.get('/api/masquerade'), cookie).send();
    status.assertStatus(200);
    const active = status.body() as {
      active: boolean;
      principal: { id: string; email: string };
      authMode: string;
      contextToken: string;
      expiresAt: string;
    };
    assert.isTrue(active.active);
    assert.equal(active.principal.id, ownerId);
    assert.equal(active.principal.email, 'bruce.wayne@wayne.example');
    assert.equal(active.authMode, 'password-only');
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
      client.get('/api/accounts/a-studio/planning'),
      secondSession.cookie
    ).send();
    secondProjected.assertStatus(200);
    const anonymiseAudits = await db.from('audit_entries').where('action', 'anonymise');
    const auditCount = anonymiseAudits.length;
    const deniedAnonymise = await asSession(
      client
        .post('/api/accounts/a-studio/resources/unavailable/anonymise')
        .header('sec-fetch-site', 'same-origin'),
      cookie,
      state.contextToken
    )
      .json({})
      .send();
    deniedAnonymise.assertStatus(403);
    assert.lengthOf(await db.from('audit_entries').where('action', 'anonymise'), auditCount);
    const read = await asSession(client.get('/api/state?accountId=a-studio'), cookie).send();
    read.assertStatus(200);
    assert.notInclude(JSON.stringify(read.body()), 'Wayne Confidential Client');
    assert.include(JSON.stringify(read.body()), 'Nightwing');
    const foreign = await asSession(client.get('/api/state?accountId=a-loft'), cookie).send();
    foreign.assertStatus(403);
    const account = await asSession(client.get('/api/accounts'), cookie).send();
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
      client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
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
    const after = await asSession(client.get('/api/accounts'), cookie).send();
    after.assertStatus(200);
    const endAudit = await db
      .from('masquerade_events')
      .where({ kind: 'stopped', actor_id: ownerId })
      .first();
    assert.equal(endAudit.actor_id, ownerId);
  });

  test('refuses unsafe and auth routes before malformed or unknown-route validation', async ({
    client,
    assert,
  }) => {
    const { cookie, targetId } = await fixture(client, 'editor');
    const started = await startView(client, cookie, targetId);
    started.assertStatus(200);
    assert.equal((started.body() as { effectiveRole: string }).effectiveRole, 'editor');
    const editorRead = await asSession(client.get('/api/state?accountId=a-studio'), cookie).send();
    editorRead.assertStatus(200);
    const examples = [
      asSession(
        client.post('/api/projects').header('sec-fetch-site', 'same-origin'),
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
      asSession(client.get('/api/accounts/a-studio/members'), cookie),
      asSession(client.get('/api/diagnostics'), cookie),
    ];
    const expectedStatuses = [403, 403, 403, 404, 403, 403, 403, 403, 403];
    for (const [index, request] of examples.entries()) {
      const response = await request.send();
      response.assertStatus(expectedStatuses[index]!);
      if (expectedStatuses[index] === 403)
        assert.equal((response.body() as { code: string }).code, 'MASQUERADE_READ_ONLY');
    }
    const malformed = await asSession(
      client
        .post('/api/no-such-route')
        .header('sec-fetch-site', 'same-origin')
        .header('content-type', 'application/json'),
      cookie,
      (started.body() as { contextToken: string }).contextToken
    ).setup((request) => {
      request.request.send('{');
    });
    malformed.assertStatus(403);
    assert.equal((malformed.body() as { code: string }).code, 'MASQUERADE_READ_ONLY');
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
      client.get('/api/masquerade?accountId=a-loft'),
      cookie
    ).send();
    elsewhere.assertStatus(200);
    const body = elsewhere.body() as {
      active: boolean;
      accountId: string;
      targetUserId: string;
      contextToken: string;
    };
    assert.isTrue(body.active);
    assert.equal(body.accountId, 'a-studio');
    assert.equal(body.targetUserId, targetId);
    assert.equal(body.contextToken, (started.body() as { contextToken: string }).contextToken);
  });

  test('rejects self, inactive target, and malformed session authority', async ({ client }) => {
    const { cookie, ownerId, targetId } = await fixture(client);
    const self = await startView(client, cookie, ownerId);
    self.assertStatus(400);
    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: targetId })
      .update({ status: 'disabled' });
    const inactive = await startView(client, cookie, targetId);
    inactive.assertStatus(403);
    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: targetId })
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
      .where({ account_id: 'a-studio', user_id: targetId })
      .update({ account_id: 'a-loft' });
    const foreign = await startView(client, cookie, targetId);
    foreign.assertStatus(403);
    await db
      .from('memberships')
      .where({ account_id: 'a-loft', user_id: targetId })
      .update({ account_id: 'a-studio' });
    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: ownerId })
      .update({ role: 'viewer' });
    const nonAdmin = await startView(client, cookie, targetId);
    nonAdmin.assertStatus(403);
    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: ownerId })
      .update({ role: 'owner' });
    await db.from('account_sessions').where('user_id', ownerId).delete();
    const revoked = await asSession(
      client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
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
      .where({ account_id: 'a-studio', user_id: ownerId })
      .update({ role: 'viewer' });
    const read = await asSession(client.get('/api/state?accountId=a-studio'), cookie).send();
    read.assertStatus(409);
    const exported = await asSession(client.get('/api/export?accountId=a-studio'), cookie).send();
    assert.oneOf(exported.status(), [403, 404]);
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
      client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
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
      id: crypto.randomUUID(),
      account_id: 'a-studio',
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
          client.post('/api/accounts/a-studio/masquerade').header('sec-fetch-site', 'same-origin'),
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
    const deniedRead = await asSession(client.get('/api/state?accountId=a-studio'), cookie).send();
    deniedRead.assertStatus(401);
    const anonymousStart = await client
      .post('/api/accounts/a-studio/masquerade')
      .header('sec-fetch-site', 'same-origin')
      .json({ targetUserId: targetId })
      .send();
    anonymousStart.assertStatus(401);
  });
});
