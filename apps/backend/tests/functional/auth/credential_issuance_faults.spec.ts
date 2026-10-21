import { createHash, randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { freshDatabase } from '../../helpers/fresh_database.js'
import router from '@adonisjs/core/services/router'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { usersAdapter } from '#services/account_kit/users_adapter'
import { requestAdministrativeReset } from '#services/credentials/operations'

const setupToken = 'credential-fault-setup-token-2026'
const waiterSignals = new Map<string, AbortSignal>()
const requestStarted = new Map<string, () => void>()

interface ResetBody {
  accountId: string
  targetUserId: string
  commandId: string
  idempotencyKey: string
  waiterKey?: string
}

router.post('/api/test/credential-issuance-faults', async (ctx) => {
  const body = ctx.request.body() as ResetBody
  if (body.waiterKey) requestStarted.get(body.waiterKey)?.()
  try {
    return ctx.response.created(
      await requestAdministrativeReset({
        ctx,
        accountId: body.accountId,
        targetUserId: body.targetUserId,
        commandId: body.commandId,
        idempotencyKey: body.idempotencyKey,
        signal: body.waiterKey ? waiterSignals.get(body.waiterKey) : undefined,
      })
    )
  } catch (error) {
    const failure = error as { status?: number; code?: string }
    return ctx.response.status(failure.status ?? 500).send({ code: failure.code ?? 'UNEXPECTED' })
  }
})

function withSession<
  T extends { setup(callback: () => void): T; withCookie(name: string, value: string): T },
>(request: T, cookie: string): T {
  return request.setup(() => {
    request.withCookie('adonis-session', cookie)
  })
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function observableAbortSignal(onWait: () => void) {
  const controller = new AbortController()
  const signal = controller.signal
  const addEventListener = signal.addEventListener.bind(signal)
  signal.addEventListener = ((...args: Parameters<AbortSignal['addEventListener']>) => {
    const [type] = args
    if (type === 'abort') onWait()
    return addEventListener(...args)
  }) as AbortSignal['addEventListener']
  return { controller, signal }
}

test.group('Administrative recovery issuance fault boundaries', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await db.from('audit_entries').delete()
    await db.from('user_session_index').delete()
    await db.from('adonis_sessions').delete()
    await db.from('accounts').delete()
    await db.from('users').delete()
  })
  group.each.teardown(async () => {
    await db.from('audit_entries').delete()
    waiterSignals.clear()
    requestStarted.clear()
  })

  async function fixture(client: ApiClient) {
    const priorMode = env.get('CAPACITYLENS_MODE')
    const priorSetup = env.get('CAPACITYLENS_SETUP_TOKEN')
    const priorScreen = env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK')
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
    env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
    const email = `hal-${randomUUID()}@wayne.example`
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email, password: 'owner-password-2026', name: 'Hal Jordan' })
      .send()
    signUp.assertStatus(201)
    const actorId = String(signUp.body().user.id)
    const cookie = signUp.cookie('adonis-session')!.value
    const accountId = randomUUID()
    const targetUserId = randomUUID()
    const now = new Date().toISOString()
    await db.table('accounts').insert({
      id: accountId,
      name: 'Wayne Enterprises',
      color: '#123456',
      created_at: now,
      updated_at: now,
    })
    await db.table('users').insert({
      id: targetUserId,
      email: `clark-${targetUserId}@wayne.example`,
      email_verified: true,
      password_hash: 'scrypt$N=131072,r=8,p=1$old$hash',
      display_name: 'Clark Kent',
      created_at: now,
      updated_at: now,
    })
    await db.table('memberships').insert([
      {
        id: randomUUID(),
        account_id: accountId,
        user_id: actorId,
        role: 'owner',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
      {
        id: randomUUID(),
        account_id: accountId,
        user_id: targetUserId,
        role: 'editor',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ])
    return {
      cookie,
      actorId,
      accountId,
      targetUserId,
      post(commandId = randomUUID(), idempotencyKey = randomUUID(), waiterKey?: string) {
        const request = withSession(client.post('/api/test/credential-issuance-faults'), cookie)
        return request
          .json({ accountId, targetUserId, commandId, idempotencyKey, waiterKey })
          .send()
      },
      restore() {
        env.set('CAPACITYLENS_MODE', priorMode ?? 'off')
        env.set('CAPACITYLENS_SETUP_TOKEN', priorSetup ?? '')
        env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', priorScreen)
      },
    }
  }

  test('returns the actual token after a committed connection-cleanup failure and rejects its duplicate', async ({
    client,
    assert,
  }) => {
    const data = await fixture(client)
    const clientConnection = db.connection().getWriteClient().client as unknown as {
      acquireConnection: (...args: unknown[]) => Promise<{
        inTransaction: boolean
        pragma: (source: string, options?: { simple?: boolean }) => unknown
      }>
    }
    type Sqlite = Awaited<ReturnType<typeof clientConnection.acquireConnection>>
    const originalAcquireConnection = clientConnection.acquireConnection
    const acquireConnection = originalAcquireConnection.bind(clientConnection)
    const wrappedConnections: Array<{ sqlite: Sqlite; pragma: Sqlite['pragma'] }> = []
    const wrapped = new WeakSet<Sqlite>()
    let armed = false
    let failed = false
    clientConnection.acquireConnection = async (...args) => {
      const sqlite = await acquireConnection(...args)
      if (wrapped.has(sqlite)) return sqlite
      wrapped.add(sqlite)
      const pragma = sqlite.pragma.bind(sqlite)
      wrappedConnections.push({ sqlite, pragma })
      let accountKitTransaction = false
      sqlite.pragma = (source: string, options?: { simple?: boolean }) => {
        if (source === 'busy_timeout = 0') accountKitTransaction = true
        if (
          armed &&
          accountKitTransaction &&
          !sqlite.inTransaction &&
          source !== 'busy_timeout = 0' &&
          source.startsWith('busy_timeout = ') &&
          !failed
        ) {
          failed = true
          throw new Error('injected post-commit busy_timeout restoration failure')
        }
        return pragma(source, options)
      }
      return sqlite
    }
    const findById = usersAdapter.findById
    usersAdapter.findById = async (id, trx) => {
      const user = await findById(id, trx)
      if (!trx && String(id) === data.targetUserId) armed = true
      return user
    }
    try {
      const commandId = randomUUID()
      const idempotencyKey = randomUUID()
      const issued = await data.post(commandId, idempotencyKey)
      issued.assertStatus(201)
      assert.isTrue(failed)
      const { token, expiresAt } = issued.body() as { token: string; expiresAt: string }
      const stored = await db
        .from('password_reset_tokens')
        .where('tokenable_id', data.targetUserId)
        .first()
      assert.equal(stored?.hash, createHash('sha256').update(token).digest('hex'))
      assert.equal(stored?.expires_at, expiresAt)
      assert.lengthOf(await db.from('audit_entries').where('account_id', data.accountId), 1)
      assert.lengthOf(await db.from('command_results').where('account_id', data.accountId), 1)
      const duplicate = await data.post(commandId, idempotencyKey)
      duplicate.assertStatus(409)
      const duplicateLink = await db
        .from('password_reset_tokens')
        .where('tokenable_id', data.targetUserId)
        .first()
      assert.equal(duplicateLink?.hash, stored?.hash)
      assert.lengthOf(await db.from('audit_entries').where('account_id', data.accountId), 1)
      assert.lengthOf(await db.from('command_results').where('account_id', data.accountId), 1)
    } finally {
      usersAdapter.findById = findById
      for (const { sqlite, pragma } of wrappedConnections) sqlite.pragma = pragma
      clientConnection.acquireConnection = originalAcquireConnection
      data.restore()
    }
  })

  test('canceled duplicate waiters do not release the leader gate before package settlement', async ({
    client,
    assert,
  }) => {
    const data = await fixture(client)
    const enteredPackage = deferred()
    const releasePackage = deferred()
    let blocked = false
    let packageReads = 0
    const findByEmail = usersAdapter.findByEmail
    usersAdapter.findByEmail = async (email, trx) => {
      const user = await findByEmail(email, trx)
      if (!trx && user?.id === data.targetUserId) {
        packageReads++
        if (!blocked) {
          blocked = true
          enteredPackage.resolve()
          await releasePackage.promise
        }
      }
      return user
    }
    const commandId = randomUUID()
    const idempotencyKey = randomUUID()
    try {
      const leader = data.post(commandId, idempotencyKey)
      await enteredPackage.promise

      const canceledWait = deferred()
      const canceledKey = randomUUID()
      const canceledSignal = observableAbortSignal(() => canceledWait.resolve())
      waiterSignals.set(canceledKey, canceledSignal.signal)
      const canceledRequestStarted = deferred()
      requestStarted.set(canceledKey, () => canceledRequestStarted.resolve())
      const canceled = data.post(commandId, idempotencyKey, canceledKey)
      await canceledRequestStarted.promise
      await canceledWait.promise
      canceledSignal.controller.abort(new Error('test waiter canceled'))
      const canceledResponse = await canceled
      assert.equal(canceledResponse.status(), 500)

      const secondWait = deferred()
      const secondKey = randomUUID()
      const secondSignal = observableAbortSignal(() => secondWait.resolve())
      waiterSignals.set(secondKey, secondSignal.signal)
      const secondRequestStarted = deferred()
      requestStarted.set(secondKey, () => secondRequestStarted.resolve())
      const duplicate = data.post(commandId, idempotencyKey, secondKey)
      await secondRequestStarted.promise
      await secondWait.promise
      assert.equal(packageReads, 1)
      releasePackage.resolve()

      const [issued, rejected] = await Promise.all([leader, duplicate])
      issued.assertStatus(201)
      rejected.assertStatus(409)
      assert.equal(packageReads, 1)
      assert.lengthOf(await db.from('audit_entries').where('account_id', data.accountId), 1)
      assert.lengthOf(await db.from('command_results').where('account_id', data.accountId), 1)
    } finally {
      releasePackage.resolve()
      usersAdapter.findByEmail = findByEmail
      data.restore()
    }
  })

  test('transaction-current target email prevents replacement and command claims', async ({
    client,
    assert,
  }) => {
    const data = await fixture(client)
    const first = await data.post()
    first.assertStatus(201)
    const previousLink = await db
      .from('password_reset_tokens')
      .where('tokenable_id', data.targetUserId)
      .first()
    const findByEmail = usersAdapter.findByEmail
    let changed = false
    usersAdapter.findByEmail = async (email, trx) => {
      const user = await findByEmail(email, trx)
      if (!trx && user?.id === data.targetUserId && !changed) {
        changed = true
        await db
          .from('users')
          .where('id', data.targetUserId)
          .update({
            email: `kal-${randomUUID()}@wayne.example`,
            updated_at: new Date().toISOString(),
          })
      }
      return user
    }
    try {
      const emailRace = await data.post()
      assert.notEqual(emailRace.status(), 201)
      const currentLink = await db
        .from('password_reset_tokens')
        .where('tokenable_id', data.targetUserId)
        .first()
      assert.equal(currentLink?.hash, previousLink?.hash)
      assert.lengthOf(await db.from('audit_entries').where('account_id', data.accountId), 1)
      assert.lengthOf(await db.from('command_results').where('account_id', data.accountId), 1)
    } finally {
      usersAdapter.findByEmail = findByEmail
      data.restore()
    }
  })

  test('transaction-current password eligibility preserves a prior link and leaves no command claim', async ({
    client,
    assert,
  }) => {
    const data = await fixture(client)
    const first = await data.post()
    first.assertStatus(201)
    const previousLink = await db
      .from('password_reset_tokens')
      .where('tokenable_id', data.targetUserId)
      .first()
    const findByEmail = usersAdapter.findByEmail
    let changed = false
    usersAdapter.findByEmail = async (email, trx) => {
      const user = await findByEmail(email, trx)
      if (!trx && user?.id === data.targetUserId && !changed) {
        changed = true
        await db.from('users').where('id', data.targetUserId).update({
          password_hash: null,
          updated_at: new Date().toISOString(),
        })
      }
      return user
    }
    try {
      const commandId = randomUUID()
      const idempotencyKey = randomUUID()
      const ineligible = await data.post(commandId, idempotencyKey)
      ineligible.assertStatus(403)
      assert.equal(ineligible.body().code, 'PASSWORD_UNAVAILABLE')
      const currentLink = await db
        .from('password_reset_tokens')
        .where('tokenable_id', data.targetUserId)
        .first()
      assert.equal(currentLink?.hash, previousLink?.hash)
      assert.isNotOk(await db.from('command_results').where('command_id', commandId).first())
      assert.lengthOf(await db.from('audit_entries').where('account_id', data.accountId), 1)
      assert.lengthOf(await db.from('command_results').where('account_id', data.accountId), 1)
    } finally {
      usersAdapter.findByEmail = findByEmail
      data.restore()
    }
  })

  test('transaction-current role loss and session revocation deny issuance without replacing the prior link', async ({
    client,
    assert,
  }) => {
    const data = await fixture(client)
    const first = await data.post()
    first.assertStatus(201)
    const previousLink = await db
      .from('password_reset_tokens')
      .where('tokenable_id', data.targetUserId)
      .first()
    const findByEmail = usersAdapter.findByEmail
    let revokeActor = false
    usersAdapter.findByEmail = async (email, trx) => {
      const user = await findByEmail(email, trx)
      if (!trx && user?.id === data.targetUserId && !revokeActor) {
        await db
          .from('memberships')
          .where({ account_id: data.accountId, user_id: data.actorId })
          .update({ role: 'viewer' })
      }
      return user
    }
    try {
      const roleLoss = await data.post()
      assert.equal(roleLoss.status(), 403)
      assert.equal(roleLoss.body().code, 'IDENTITY_AUTHORITY_DENIED')
      const afterRoleLoss = await db
        .from('password_reset_tokens')
        .where('tokenable_id', data.targetUserId)
        .first()
      assert.equal(afterRoleLoss?.hash, previousLink?.hash)
      assert.lengthOf(await db.from('audit_entries').where('account_id', data.accountId), 1)

      await db
        .from('memberships')
        .where({ account_id: data.accountId, user_id: data.actorId })
        .update({ role: 'owner' })
      revokeActor = true
      usersAdapter.findByEmail = async (email, trx) => {
        const user = await findByEmail(email, trx)
        if (!trx && user?.id === data.targetUserId) {
          await db.from('user_session_index').where('user_id', data.actorId).delete()
        }
        return user
      }
      const sessionLoss = await data.post()
      assert.equal(sessionLoss.status(), 401)
      assert.equal(sessionLoss.body().code, 'SESSION_INVALID')
      const afterSessionLoss = await db
        .from('password_reset_tokens')
        .where('tokenable_id', data.targetUserId)
        .first()
      assert.equal(afterSessionLoss?.hash, previousLink?.hash)
      assert.lengthOf(await db.from('audit_entries').where('account_id', data.accountId), 1)
      assert.lengthOf(await db.from('command_results').where('account_id', data.accountId), 1)
    } finally {
      usersAdapter.findByEmail = findByEmail
      data.restore()
    }
  })
})
