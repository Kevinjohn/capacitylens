import { test } from '@japa/runner'
import type { HttpContext } from '@adonisjs/core/http'
import { freshDatabase } from '#tests/helpers/fresh_database'
import db from '@adonisjs/lucid/services/db'
import type { ResolvedContext } from '@kevinjohn/adonisjs-masquerade'
import { errors as masqueradeErrors } from '@kevinjohn/adonisjs-masquerade'
import { resetState } from '#tests/helpers/state_fixture'
import { createFixtureCompanyForOwner } from '#tests/helpers/authenticated_data_fixture'
import { clearIdentities, signIn } from '#tests/helpers/identities'
import { requestBarrier } from '#tests/helpers/request_barrier'
import { masqueradeAdmission } from '#tests/helpers/masquerade_admission'
import app from '@adonisjs/core/services/app'
import { MasqueradeModeService } from '#services/auth/masquerade_mode_service'
import { ClientFactory } from '#database/factories/client_factory'
import { CompanyFactory } from '#database/factories/company_factory'
import {
  storageMaintenance,
  password,
  asSession,
  verifiedIdentity,
  masqueradeToken,
  startView,
  fixture,
  adminFixture,
  promoteToOwner,
  privateClientName,
  insertPrivateClient,
  endView,
} from '#tests/helpers/auth/masquerade'

test.group('native read-only masquerade', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await clearIdentities()
  })

  test('requires the current context for idle writes and refuses writes in view mode', async ({
    client,
    assert,
  }) => {
    const { cookie, targetId, owner } = await fixture(client)
    const missing = await asSession(
      client
        .visit('api.masquerade.store', { companyId: 'a-studio' })
        .header('sec-fetch-site', 'same-origin'),
      owner
    )
      .json({ targetUserId: targetId })
      .send()
    missing.assertStatus(428)
    assert.equal(
      (missing.body() as unknown as { code: string }).code,
      'E_MASQUERADE_CONTEXT_REQUIRED'
    )

    const idleToken = await masqueradeToken(client, cookie)
    const stale = await asSession(
      client
        .visit('api.masquerade.store', { companyId: 'a-studio' })
        .header('sec-fetch-site', 'same-origin'),
      owner,
      '0.00000000000000000000000000000000'
    )
      .json({ targetUserId: targetId })
      .send()
    stale.assertStatus(409)
    assert.equal((stale.body() as unknown as { code: string }).code, 'E_MASQUERADE_CONTEXT_CHANGED')

    const started = await asSession(
      client
        .visit('api.masquerade.store', { companyId: 'a-studio' })
        .header('sec-fetch-site', 'same-origin'),
      owner,
      idleToken
    )
      .json({ targetUserId: targetId })
      .send()
    started.assertStatus(200)
    const mode = (started.body() as { data: unknown }).data as { masqueradeToken: string }
    const capturedIdleStart = await asSession(
      client
        .visit('api.masquerade.store', { companyId: 'a-studio' })
        .header('sec-fetch-site', 'same-origin'),
      owner,
      idleToken
    )
      .json({ targetUserId: targetId })
      .send()
    capturedIdleStart.assertStatus(409)
    assert.equal(
      (capturedIdleStart.body() as unknown as { code: string }).code,
      'E_MASQUERADE_CONTEXT_CHANGED'
    )
    const write = await asSession(
      client
        .visit('api.getting_started.update', { companyId: 'a-studio' })
        .header('sec-fetch-site', 'same-origin'),
      owner,
      mode.masqueradeToken
    )
      .json({} as never)
      .send()
    write.assertStatus(403)
    assert.equal((write.body() as unknown as { code: string }).code, 'E_MASQUERADE_READ_ONLY')
  })

  for (const { label, role, canSeeTimeOffNote } of [
    { label: 'an Editor', role: 'editor', canSeeTimeOffNote: false },
    { label: 'an Admin', role: 'admin', canSeeTimeOffNote: true },
  ] as const) {
    test(`sends only the read key and the target flags while viewing ${label}`, async ({
      client,
      assert,
    }) => {
      const { cookie, targetId, owner } = await fixture(client, role)
      const started = await startView(client, cookie, targetId)
      started.assertStatus(200)
      const grantOf = (body: Record<string, unknown>) => ({
        effectiveRole: body.effectiveRole,
        permissions: body.permissions,
        canSeePrivateNames: body.canSeePrivateNames,
        canSeeTimeOffNote: body.canSeeTimeOffNote,
      })
      const readOnly = {
        effectiveRole: role,
        permissions: ['planning:read'],
        canSeePrivateNames: false,
        canSeeTimeOffNote,
      }
      assert.deepEqual(grantOf(started.body().data), readOnly)
      const { startedAt, expiresAt } = started.body().data as {
        startedAt: string
        expiresAt: string
      }
      // config/masquerade.ts sets durationSeconds: 900; the package derives the expiry from it.
      assert.equal(Date.parse(expiresAt) - Date.parse(startedAt), 900_000)
      const status = await asSession(
        client.visit('api.masquerade.show').qs({ companyId: 'a-studio' }),
        owner
      ).send()
      status.assertStatus(200)
      const statusBody = status.body() as unknown as { data: Record<string, unknown> }
      assert.isTrue(statusBody.data.active)
      assert.deepEqual(grantOf(statusBody.data), readOnly)
    })
  }

  test('rejects planning reads carrying a context from before a remote mode change', async ({
    client,
    assert,
  }) => {
    const { cookie, targetId } = await fixture(client)
    const secondSession = await signIn(client, 'bruce.wayne@wayne.example', password)
    const idleToken = await masqueradeToken(client, cookie)

    const started = await startView(client, secondSession.cookie, targetId)
    started.assertStatus(200)
    const activeToken = (started.body().data as { masqueradeToken: string }).masqueradeToken

    const staleIdleRead = await asSession(
      client.visit('api.planning.show', { companyId: 'a-studio' }),
      cookie,
      idleToken
    ).send()
    staleIdleRead.assertStatus(409)
    assert.deepEqual(staleIdleRead.body(), {
      error: 'Masquerade context changed.',
      code: 'E_MASQUERADE_CONTEXT_CHANGED',
    })

    const stopped = await asSession(
      client.visit('api.masquerade.destroy').header('sec-fetch-site', 'same-origin'),
      secondSession.cookie,
      activeToken
    )
      .json({ token: activeToken, reason: 'explicit' })
      .send()
    stopped.assertStatus(200)

    const staleActiveRead = await asSession(
      client.visit('api.planning.show', { companyId: 'a-studio' }),
      cookie,
      activeToken
    ).send()
    staleActiveRead.assertStatus(409)
    assert.deepEqual(staleActiveRead.body(), {
      error: 'Masquerade context changed.',
      code: 'E_MASQUERADE_CONTEXT_CHANGED',
    })
  })

  test('returns a flat product error when a package storage error escapes middleware', async ({
    client,
    assert,
  }) => {
    const { owner } = await fixture(client)
    const service = await masqueradeAdmission()
    const serviceWithTestFailure = service as unknown as {
      resolve(request: HttpContext): Promise<ResolvedContext>
    }
    const originalResolve = service.resolve.bind(service)
    const failure = new masqueradeErrors.E_MASQUERADE_UNAVAILABLE()
    serviceWithTestFailure.resolve = async () => {
      throw failure
    }
    try {
      const response = await asSession(
        client.visit('api.planning.show', { companyId: 'a-studio' }),
        owner
      ).send()
      response.assertStatus(503)
      assert.deepEqual(response.body(), {
        error: 'Masquerade is unavailable.',
        code: 'E_MASQUERADE_UNAVAILABLE',
      })
    } finally {
      serviceWithTestFailure.resolve = originalResolve
    }
  })

  test('keeps a captured active projection read-only after a concurrent stop', async ({
    client,
    assert,
  }) => {
    const { cookie: sessionCookie, targetId, owner } = await fixture(client)
    const started = await startView(client, sessionCookie, targetId)
    started.assertStatus(200)
    const activeToken = (started.body().data as { masqueradeToken: string }).masqueradeToken
    const service = await masqueradeAdmission()
    const serviceWithTestGate = service as unknown as {
      resolve(request: HttpContext): Promise<ResolvedContext>
    }
    const originalResolve = service.resolve.bind(service)
    const gate = requestBarrier()
    serviceWithTestGate.resolve = async (request) => {
      const resolved = await originalResolve(request)
      if (request.request.header('x-test-admission-pause') === 'active') {
        await gate.pause()
      }
      return resolved
    }

    try {
      const pendingWrite = asSession(
        client
          .visit('api.getting_started.update', { companyId: 'a-studio' })
          .header('sec-fetch-site', 'same-origin')
          .header('x-test-admission-pause', 'active'),
        owner,
        activeToken
      )
        .json({ dismissed: true })
        .send()
      await gate.entered()
      const stopped = await asSession(
        client.visit('api.masquerade.destroy').header('sec-fetch-site', 'same-origin'),
        owner,
        activeToken
      )
        .json({ token: activeToken, reason: 'explicit' })
        .send()
      stopped.assertStatus(200)
      gate.release()
      const refused = await pendingWrite
      refused.assertStatus(403)
      assert.equal((refused.body() as unknown as { code: string }).code, 'E_MASQUERADE_READ_ONLY')
      assert.isNull(
        await db.from('company_getting_started_dismissals').where('company_id', 'a-studio').first()
      )
    } finally {
      gate.release()
      serviceWithTestGate.resolve = originalResolve
    }
  })

  test('uses the target role for reads, real actor for audit, and explicit end restores access', async ({
    client,
    assert,
  }) => {
    const { cookie, ownerId, targetId, owner } = await fixture(client)
    await ClientFactory.merge({
      companyId: 'a-studio',
      name: 'Wayne Confidential Client',
      codeName: 'Nightwing',
      color: '#123456',
      isPrivate: true,
    }).create()
    const ownerRead = await asSession(
      client.visit('api.company_state.show').qs({ companyId: 'a-studio' }),
      owner
    ).send()
    ownerRead.assertStatus(200)
    assert.include(JSON.stringify(ownerRead.body().data), 'Wayne Confidential Client')
    const started = await startView(client, cookie, targetId)
    started.assertStatus(200)
    const state = started.body().data as {
      companyId: string
      targetUserId: string
      effectiveRole: string
      token: string
      masqueradeToken: string
      expiresAt: string
    }
    assert.equal(state.companyId, 'a-studio')
    assert.equal(state.targetUserId, targetId)
    assert.equal(state.effectiveRole, 'viewer')
    assert.equal(state.masqueradeToken, state.token)
    assert.isAbove(Date.parse(state.expiresAt), Date.now())
    const projected = await asSession(
      client.visit('api.planning.show', { companyId: 'a-studio' }),
      owner
    ).send()
    projected.assertStatus(200)
    const status = await asSession(client.visit('api.masquerade.show'), owner).send()
    status.assertStatus(200)
    // Raw query strings, so the empty and repeated values reach the server as written.
    for (const query of ['companyId=', 'companyId=a-studio&companyId=a-loft']) {
      const malformed = await asSession(
        client.visit('api.masquerade.show').unsafeQs(query),
        owner
      ).send()
      malformed.assertStatus(422)
      assert.equal(
        (malformed.body() as unknown as { errors: Array<{ field: string }> }).errors[0]?.field,
        'companyId'
      )
    }
    const active = status.body()!.data as {
      active: boolean
      actor: { id: string; email: string }
      masqueradeToken: string
      expiresAt: string
    }
    assert.isTrue(active.active)
    assert.equal(active.actor.id, ownerId)
    assert.equal(active.actor.email, 'bruce.wayne@wayne.example')
    assert.equal(active.masqueradeToken, state.masqueradeToken)
    assert.equal(active.expiresAt, state.expiresAt)
    const secondSession = await signIn(client, 'bruce.wayne@wayne.example', password)
    const secondStatus = await asSession(
      client.visit('api.masquerade.show'),
      secondSession.cookie
    ).send()
    secondStatus.assertStatus(200)
    assert.isTrue((secondStatus.body()!.data as { active: boolean }).active)
    assert.equal(
      (secondStatus.body()!.data as { masqueradeToken: string }).masqueradeToken,
      state.masqueradeToken
    )
    const secondProjected = await asSession(
      client.visit('api.planning.show', { companyId: 'a-studio' }),
      secondSession.cookie
    ).send()
    secondProjected.assertStatus(200)
    const anonymiseAudits = await db.from('audit_entries').where('operation', 'anonymise')
    const auditCount = anonymiseAudits.length
    const deniedAnonymise = await asSession(
      client
        .visit('api.resource_anonymisations.store', { companyId: 'a-studio', id: 'unavailable' })
        .header('sec-fetch-site', 'same-origin'),
      owner,
      state.masqueradeToken
    )
      .json({})
      .send()
    deniedAnonymise.assertStatus(403)
    assert.lengthOf(await db.from('audit_entries').where('operation', 'anonymise'), auditCount)
    const read = await asSession(
      client.visit('api.company_state.show').qs({ companyId: 'a-studio' }),
      owner
    ).send()
    read.assertStatus(200)
    assert.notInclude(JSON.stringify(read.body().data), 'Wayne Confidential Client')
    assert.include(JSON.stringify(read.body().data), 'Nightwing')
    const inactiveExport = await asSession(
      client.visit('api.company_state.show').qs({ companyId: 'a-studio', includeInactive: '1' }),
      owner
    ).send()
    inactiveExport.assertStatus(403)
    const foreign = await asSession(
      client.visit('api.company_state.show').qs({ companyId: 'a-loft' }),
      owner
    ).send()
    foreign.assertStatus(403)
    const directory = await asSession(client.visit('api.companies.index'), owner).send()
    directory.assertStatus(403)
    assert.equal((directory.body() as unknown as { code: string }).code, 'E_MASQUERADE_READ_ONLY')
    const audit = await db
      .from('masquerade_events')
      .where({ kind: 'started', actor_id: ownerId })
      .first()
    assert.equal(audit.actor_id, ownerId)

    const ended = await asSession(
      client.visit('api.masquerade.destroy').header('sec-fetch-site', 'same-origin'),
      owner,
      state.masqueradeToken
    )
      .json({ token: state.token, reason: 'explicit' })
      .send()
    ended.assertStatus(200)
    assert.isFalse((ended.body()!.data as { active: boolean }).active)
    const capturedActiveStart = await asSession(
      client
        .visit('api.masquerade.store', { companyId: 'a-studio' })
        .header('sec-fetch-site', 'same-origin'),
      owner,
      state.masqueradeToken
    )
      .json({ targetUserId: targetId })
      .send()
    capturedActiveStart.assertStatus(409)
    assert.equal(
      (capturedActiveStart.body() as unknown as { code: string }).code,
      'E_MASQUERADE_CONTEXT_CHANGED'
    )
    const after = await asSession(client.visit('api.companies.index'), owner).send()
    after.assertStatus(200)
    const endAudit = await db
      .from('masquerade_events')
      .where({ kind: 'stopped', actor_id: ownerId })
      .first()
    assert.equal(endAudit.actor_id, ownerId)
  })

  test('refuses unsafe and auth routes while viewing, and answers unknown routes with 404', async ({
    client,
    assert,
  }) => {
    const { cookie, targetId, owner } = await fixture(client, 'editor')
    const started = await startView(client, cookie, targetId)
    started.assertStatus(200)
    assert.equal((started.body().data as { effectiveRole: string }).effectiveRole, 'editor')
    const editorRead = await asSession(
      client.visit('api.company_state.show').qs({ companyId: 'a-studio' }),
      owner
    ).send()
    editorRead.assertStatus(200)
    const examples = [
      asSession(
        client
          .visit('api.getting_started.update', { companyId: 'a-studio' })
          .header('sec-fetch-site', 'same-origin'),
        owner,
        (started.body().data as { masqueradeToken: string }).masqueradeToken
      ).json({} as never),
      asSession(
        client.post('/api/v1/no-such-route').header('sec-fetch-site', 'same-origin'),
        owner,
        (started.body().data as { masqueradeToken: string }).masqueradeToken
      ).json({}),
      asSession(
        client.post('/api/v1/masquerade').header('sec-fetch-site', 'same-origin'),
        owner,
        (started.body().data as { masqueradeToken: string }).masqueradeToken
      ).json({}),
      asSession(
        client.post('/no-such-route').header('sec-fetch-site', 'same-origin'),
        owner,
        (started.body().data as { masqueradeToken: string }).masqueradeToken
      ).json({}),
      asSession(
        client.visit('api.session.store').header('sec-fetch-site', 'same-origin'),
        owner,
        (started.body().data as { masqueradeToken: string }).masqueradeToken
      ).json({} as never),
      asSession(
        client.post('/api/v1/auth/register').header('sec-fetch-site', 'same-origin'),
        owner,
        (started.body().data as { masqueradeToken: string }).masqueradeToken
      ).json({}),
      asSession(client.visit('api.session.show'), owner),
      asSession(client.visit('api.members.index', { companyId: 'a-studio' }), owner),
      asSession(client.visit('api.diagnostics.show'), owner),
    ]
    // Masquerade route rules run after route matching, so a write to a path with no route is a 404 (#1865).
    const expectedStatuses = [403, 404, 404, 404, 403, 404, 403, 403, 403]
    for (const [index, request] of examples.entries()) {
      const response = await request.send()
      response.assertStatus(expectedStatuses[index]!)
      if (expectedStatuses[index] === 403)
        assert.equal((response.body() as { code: string }).code, 'E_MASQUERADE_READ_ONLY')
    }
    const malformed = await asSession(
      client
        .visit('api.getting_started.update', { companyId: 'a-studio' })
        .header('sec-fetch-site', 'same-origin')
        .header('content-type', 'application/json'),
      owner,
      (started.body().data as { masqueradeToken: string }).masqueradeToken
    ).setup((request) => {
      request.request.send('{')
    })
    // The body parser runs before the masquerade route rules, so a malformed write is refused as malformed.
    malformed.assertStatus(400)
    assert.notExists(
      await db.from('company_getting_started_dismissals').where('company_id', 'a-studio').first()
    )
    const signedOut = await asSession(
      client.visit('api.session.destroy').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({})
      .send()
    signedOut.assertStatus(200)
    assert.equal(
      await db
        .from('masquerade_modes')
        .where({
          actor_id: (started.body().data as { actor: { id: string } }).actor?.id,
          state: 'active',
        })
        .count('* as total')
        .first()
        .then((row) => row?.total),
      1
    )
  })

  test('reports the active view where it holds when another company is requested', async ({
    client,
    assert,
  }) => {
    const { cookie, ownerId, targetId, owner } = await fixture(client)
    await createFixtureCompanyForOwner(ownerId, 'Stark Industries', 'a-loft')
    const started = await startView(client, cookie, targetId)
    started.assertStatus(200)
    const elsewhere = await asSession(
      client.visit('api.masquerade.show').qs({ companyId: 'a-loft' }),
      owner
    ).send()
    elsewhere.assertStatus(200)
    const body = (elsewhere.body() as { data: unknown }).data as {
      active: boolean
      companyId: string
      targetUserId: string
      masqueradeToken: string
    }
    assert.isTrue(body.active)
    assert.equal(body.companyId, 'a-studio')
    assert.equal(body.targetUserId, targetId)
    assert.equal(
      body.masqueradeToken,
      (started.body().data as { masqueradeToken: string }).masqueradeToken
    )
  })

  test('rejects self, inactive target, and malformed session access', async ({
    client,
    assert,
  }) => {
    const { cookie, ownerId, targetId } = await fixture(client)
    const self = await startView(client, cookie, ownerId)
    self.assertStatus(422)
    assert.deepEqual(self.body(), { errors: [{ message: 'Invalid masquerade request.' }] })
    await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: targetId })
      .update({ status: 'suspended' })
    const inactive = await startView(client, cookie, targetId)
    inactive.assertStatus(403)
    await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: targetId })
      .update({ status: 'active' })
    await CompanyFactory.merge({
      id: 'a-loft',
      name: 'Stark Industries',
      color: '#123456',
    }).create()
    await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: targetId })
      .update({ scope_id: 'a-loft' })
    const foreign = await startView(client, cookie, targetId)
    foreign.assertStatus(403)
    await db
      .from('memberships')
      .where({ scope_id: 'a-loft', user_id: targetId })
      .update({ scope_id: 'a-studio' })
    await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: ownerId })
      .update({ role: 'viewer' })
    const nonAdmin = await startView(client, cookie, targetId)
    nonAdmin.assertStatus(403)
    await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: ownerId })
      .update({ role: 'owner' })
    await db.from('account_sessions').where('user_id', ownerId).delete()
    const revoked = await asSession(
      client
        .visit('api.masquerade.store', { companyId: 'a-studio' })
        .header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ targetUserId: targetId })
      .send()
    revoked.assertStatus(401)
  })

  test('ends an open view as soon as the viewer loses the role that permits it', async ({
    client,
    assert,
  }) => {
    const { cookie, ownerId, targetId, owner } = await fixture(client, 'editor')
    const started = await startView(client, cookie, targetId)
    started.assertStatus(200)
    await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: ownerId })
      .update({ role: 'viewer' })
    const read = await asSession(
      client.visit('api.company_state.show').qs({ companyId: 'a-studio' }),
      owner
    ).send()
    read.assertStatus(409)
    const status = await asSession(client.visit('api.masquerade.show'), owner).send()
    status.assertStatus(200)
    const current = status.body()!.data as { active: boolean; masqueradeToken: string }
    assert.isFalse(current.active)
    const ended = await asSession(
      client.visit('api.masquerade.destroy').header('sec-fetch-site', 'same-origin'),
      owner,
      current.masqueradeToken
    )
      .json({ token: current.masqueradeToken, reason: 'explicit' })
      .send()
    ended.assertStatus(200)
  })

  test('allows a valid Owner session older than the fresh-action window to start viewing', async ({
    client,
    assert,
  }) => {
    const { cookie, ownerId, targetId } = await fixture(client)
    await db
      .from('account_sessions')
      .where('user_id', ownerId)
      .update({ created_at: new Date(Date.now() - 16 * 60_000).toISOString() })
    const started = await startView(client, cookie, targetId)
    started.assertStatus(200)
    assert.equal((started.body().data as { targetUserId: string }).targetUserId, targetId)
  })

  test('the scheduled prune deletes events older than the configured retention', async ({
    client,
    assert,
  }) => {
    const { cookie, ownerId, targetId } = await fixture(client)
    const started = await startView(client, cookie, targetId)
    started.assertStatus(200)
    await db
      .from('masquerade_events')
      .where({ actor_id: ownerId, kind: 'started' })
      .update({ at: new Date(Date.now() - 366 * 24 * 60 * 60_000).toISOString() })

    await storageMaintenance.pruneExpiredMasquerades(app)

    assert.isEmpty(await db.from('masquerade_events').where({ actor_id: ownerId, kind: 'started' }))
  })

  test('ends the view when the target changes credentials', async ({ client, assert }) => {
    const { cookie, targetId, owner } = await fixture(client)
    const started = await startView(client, cookie, targetId)
    started.assertStatus(200)
    await db
      .from('users')
      .where('id', targetId)
      .update({ credentials_changed_at: new Date().toISOString() })
    const status = await asSession(client.visit('api.masquerade.show'), owner).send()
    status.assertStatus(200)
    assert.isFalse((status.body()!.data as { active: boolean }).active)
  })

  test('reports inactive for anonymous and revoked sessions without restoring data access', async ({
    client,
    assert,
  }) => {
    const anonymous = await client.visit('api.masquerade.show').send()
    anonymous.assertStatus(200)
    assert.deepEqual(anonymous.body()!.data, { active: false, masqueradeToken: null })
    const { cookie, targetId } = await fixture(client)
    const started = await startView(client, cookie, targetId)
    started.assertStatus(200)
    await db.from('account_sessions').delete()
    const revoked = await asSession(client.visit('api.masquerade.show'), cookie).send()
    revoked.assertStatus(200)
    assert.deepEqual(revoked.body()!.data, { active: false, masqueradeToken: null })
    const deniedRead = await asSession(
      client.visit('api.company_state.show').qs({ companyId: 'a-studio' }),
      cookie
    ).send()
    deniedRead.assertStatus(401)
    const anonymousStart = await client
      .visit('api.masquerade.store', { companyId: 'a-studio' })
      .header('sec-fetch-site', 'same-origin')
      .json({ targetUserId: targetId })
      .send()
    anonymousStart.assertStatus(401)
    assert.deepEqual(anonymousStart.body(), {
      error: 'Sign-in required.',
      code: 'E_SIGN_IN_REQUIRED',
    })
  })

  test('view-as controls answer package refusals with the shared error codes', async ({
    client,
    assert,
  }) => {
    const { cookie, targetId, owner } = await fixture(client)
    const { id: outsiderId } = await verifiedIdentity(
      'diana.prince@themyscira.example',
      'Diana Prince'
    )
    const outsider = await startView(client, cookie, outsiderId)
    outsider.assertStatus(403)
    assert.deepEqual(outsider.body(), {
      error: 'This action is not allowed.',
      code: 'E_AUTHORIZATION_DENIED',
    })

    const started = await startView(client, cookie, targetId)
    started.assertStatus(200)
    const again = await startView(client, cookie, targetId)
    again.assertStatus(409)
    assert.deepEqual(again.body(), {
      error: 'Masquerade is already active.',
      code: 'E_MASQUERADE_ACTIVE',
    })
    const activeToken = await masqueradeToken(client, cookie)
    const ended = await asSession(
      client.visit('api.masquerade.destroy').header('sec-fetch-site', 'same-origin'),
      owner,
      activeToken
    )
      .json({ token: activeToken, reason: 'explicit' })
      .send()
    ended.assertStatus(200)

    const masqueradeModes = await app.container.make(MasqueradeModeService)
    const service = await masqueradeModes.getMasqueradeService()
    const originalStart = service.start
    try {
      for (const [code, status, body] of [
        [
          'E_MASQUERADE_UNAUTHENTICATED',
          401,
          { error: 'Sign-in required.', code: 'E_SIGN_IN_REQUIRED' },
        ],
        [
          'E_MASQUERADE_UNAVAILABLE',
          503,
          { error: 'Masquerade is unavailable.', code: 'E_MASQUERADE_UNAVAILABLE' },
        ],
      ] as const) {
        service.start = async () => {
          throw new masqueradeErrors[code]()
        }
        const refused = await startView(client, cookie, targetId)
        refused.assertStatus(status)
        assert.deepEqual(refused.body(), body)
      }
    } finally {
      service.start = originalStart
    }
  })

  test('refuses an Admin a view as the Owner and creates no mode', async ({ client, assert }) => {
    const { cookie, companyOwnerId, owner } = await adminFixture(client)
    const refused = await startView(client, cookie, companyOwnerId)
    refused.assertStatus(403)
    const status = await asSession(
      client.visit('api.masquerade.show').qs({ companyId: 'a-studio' }),
      owner
    ).send()
    status.assertStatus(200)
    assert.isFalse(((status.body() as { data: unknown }).data as { active: boolean }).active)
  })

  test('lets an Admin view as an Admin, Editor or Viewer', async ({ client, assert }) => {
    const { cookie, targetId, owner } = await adminFixture(client, 'admin')
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      await db
        .from('memberships')
        .where({ scope_id: 'a-studio', user_id: targetId })
        .update({ role })
      const started = await startView(client, cookie, targetId)
      started.assertStatus(200)
      assert.equal((started.body().data as { effectiveRole: string }).effectiveRole, role)
      const read = await asSession(
        client.visit('api.planning.show', { companyId: 'a-studio' }),
        owner
      ).send()
      read.assertStatus(200)
      await endView(client, cookie)
    }
  })

  test("ends an Admin's view when the target is promoted to Owner", async ({ client, assert }) => {
    const { cookie, adminId, companyOwnerId, targetId, owner } = await adminFixture(client)
    await insertPrivateClient()
    // The first refused read ends the mode, so each read gets its own view.
    for (const [index, [path, request]] of (
      [
        ['planning', () => client.visit('api.planning.show', { companyId: 'a-studio' })],
        ['state', () => client.visit('api.company_state.show').qs({ companyId: 'a-studio' })],
        ['export', () => client.visit('api.company_export.show', { companyId: 'a-studio' })],
      ] as const
    ).entries()) {
      await db
        .from('memberships')
        .where({ scope_id: 'a-studio', user_id: companyOwnerId })
        .update({ role: 'owner' })
      await db
        .from('memberships')
        .where({ scope_id: 'a-studio', user_id: targetId })
        .update({ role: 'editor' })
      const started = await startView(client, cookie, targetId)
      started.assertStatus(200)
      await promoteToOwner(targetId, companyOwnerId)
      const read = await asSession(request(), owner).send()
      const ended = await db
        .from('masquerade_events')
        .where({ actor_id: adminId, kind: 'invalidated', outcome_code: 'policy_denied' })
      assert.lengthOf(ended, index + 1, path)
      read.assertStatus(409)
      assert.notInclude(read.text(), privateClientName, path)
      const status = await asSession(
        client.visit('api.masquerade.show').qs({ companyId: 'a-studio' }),
        owner
      ).send()
      status.assertStatus(200)
      const current = (status.body() as { data: unknown }).data as {
        active: boolean
        effectiveRole?: string
      }
      assert.isFalse(current.active, path)
      assert.notEqual(current.effectiveRole, 'owner', path)
    }
  })

  test('refuses a planning read admitted before the target was promoted above the Admin', async ({
    client,
    assert,
  }) => {
    const { cookie, companyOwnerId, targetId, owner } = await adminFixture(client)
    await insertPrivateClient()
    const started = await startView(client, cookie, targetId)
    started.assertStatus(200)
    const service = await masqueradeAdmission()
    const serviceWithTestGate = service as unknown as {
      resolve(request: HttpContext): Promise<ResolvedContext>
    }
    const originalResolve = service.resolve.bind(service)
    const gate = requestBarrier()
    serviceWithTestGate.resolve = async (request) => {
      const resolved = await originalResolve(request)
      if (request.request.header('x-test-admission-pause') === 'promote') {
        await gate.pause()
      }
      return resolved
    }
    try {
      const pendingRead = asSession(
        client
          .visit('api.planning.show', { companyId: 'a-studio' })
          .header('x-test-admission-pause', 'promote'),
        owner
      ).send()
      await gate.entered()
      await promoteToOwner(targetId, companyOwnerId)
      gate.release()
      const read = await pendingRead
      read.assertStatus(403)
      assert.equal((read.body() as unknown as { code: string }).code, 'E_ACCOUNT_MEMBERSHIP_LOST')
      assert.notInclude(read.text(), privateClientName)
    } finally {
      gate.release()
      serviceWithTestGate.resolve = originalResolve
    }
  })

  test('refuses a state read in the company where the target outranks the Admin', async ({
    client,
    assert,
  }) => {
    const { cookie, adminId, companyOwnerId, targetId, owner } = await adminFixture(client)
    await insertPrivateClient()
    await createFixtureCompanyForOwner(adminId, 'Stark Industries', 'a-tower')
    const now = new Date().toISOString()
    await db.table('memberships').insert({
      scope_id: 'a-tower',
      user_id: targetId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    const started = await startView(client, cookie, targetId)
    started.assertStatus(200)
    await promoteToOwner(targetId, companyOwnerId)
    // The query names no route company, so admission accepts the view through a-tower and only
    // the in-transaction check sees that the target outranks the Admin in a-studio.
    const read = await asSession(
      client.visit('api.company_state.show').qs({ companyId: 'a-studio' }),
      owner
    ).send()
    read.assertStatus(403)
    // Only a planning read answers E_ACCOUNT_MEMBERSHIP_LOST; the state read keeps its own code.
    assert.equal(
      (read.body() as unknown as { code: string }).code,
      'E_IDENTITY_AUTHORIZATION_DENIED'
    )
    assert.notInclude(read.text(), privateClientName)
  })

  test("reports an Admin's view only where the target does not outrank them", async ({
    client,
    assert,
  }) => {
    const { cookie, adminId, companyOwnerId, targetId, owner } = await adminFixture(client)
    await createFixtureCompanyForOwner(adminId, 'Stark Industries', 'a-tower')
    const now = new Date().toISOString()
    await db.table('memberships').insert({
      scope_id: 'a-tower',
      user_id: targetId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    const started = await startView(client, cookie, targetId)
    started.assertStatus(200)
    await promoteToOwner(targetId, companyOwnerId)
    // a-studio sorts first, so the status search reaches it before a-tower.
    for (const [path, request] of [
      ['with a company', () => client.visit('api.masquerade.show').qs({ companyId: 'a-studio' })],
      ['without a company', () => client.visit('api.masquerade.show')],
    ] as const) {
      const status = await asSession(request(), owner).send()
      status.assertStatus(200)
      assert.deepInclude(
        (status.body() as { data: unknown }).data,
        { active: true, companyId: 'a-tower', effectiveRole: 'editor' },
        path
      )
    }
  })
})
