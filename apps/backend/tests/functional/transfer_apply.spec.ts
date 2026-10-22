import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { buildBetaExport, type BetaExportDocument } from '@capacitylens/shared/data/betaTransfer'
import { readState } from '#services/state_repository'
import { getPlanningRevision } from '#services/planning_revision'
import { withTransaction } from '#services/with_transaction'
import { asDataOwner, resetAuthenticatedData } from '../helpers/authenticated_data_fixture.js'
import { freshDatabase } from '../helpers/fresh_database.js'
import type { ApiClient } from '@japa/api-client'

const accountId = 'a-studio'
const password = 'fixture-password-2026'

async function document() {
  return buildBetaExport(await readState(accountId, true), { accountId, completeness: 'full' })
}

async function revision() {
  return withTransaction((trx) => getPlanningRevision(trx, accountId))
}

async function proof(client: ApiClient, cookie: string, intent: unknown, action = 'import') {
  const result = await asDataOwner(client.post('/api/auth/action-proof/password'), cookie)
    .json({ action, accountId, intent, password })
    .send()
  result.assertStatus(200)
  return (result.body() as { proofId: string }).proofId
}

async function apply(
  client: ApiClient,
  cookie: string,
  documentValue: BetaExportDocument,
  baseRevision: number,
  proofId?: string
) {
  return asDataOwner(client.post('/api/transfer/apply'), cookie)
    .json({ accountId, document: documentValue, baseRevision, ...(proofId ? { proofId } : {}) })
    .send()
}

test.group('beta transfer apply', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await db.from('account_member_resources').delete()
  })

  test('requires exact action proof even immediately after owner sign-in', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client)
    const full = await document()
    const baseRevision = await revision()
    const missing = await apply(client, cookie, full, baseRevision)
    missing.assertStatus(403)
    const validProof = await proof(client, cookie, { baseRevision, document: full })
    const unchanged = await apply(client, cookie, full, baseRevision, validProof)
    unchanged.assertStatus(200)
    assert.deepInclude(unchanged.body(), { changed: false, revision: baseRevision })
    const again = await apply(client, cookie, full, baseRevision, validProof)
    again.assertStatus(403)
    assert.equal(await revision(), baseRevision)
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, action: 'import' }),
      0
    )
  })

  test('previews and applies changed data with stable IDs, links, one revision and one audit', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client)
    const full = await document()
    full.data.accounts[0]!.name += ' confirmed'
    const before = await readState(accountId, true)
    const linkedPerson = before.resources.find((row) => row.kind === 'person')!
    await db.table('account_member_resources').insert({
      id: 'link-bruce-person',
      account_id: accountId,
      user_id: userId,
      resource_id: linkedPerson.id,
      revision: 'test',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    const preview = await asDataOwner(client.post('/api/transfer/preview'), cookie)
      .json({ accountId, document: full })
      .send()
    preview.assertStatus(200)
    assert.equal((preview.body() as { changed: boolean }).changed, true)
    const baseRevision = (preview.body() as { baseRevision: number }).baseRevision
    const actionProof = await proof(client, cookie, { baseRevision, document: full })
    const result = await apply(client, cookie, full, baseRevision, actionProof)
    result.assertStatus(200)
    assert.deepInclude(result.body(), { changed: true, revision: baseRevision + 1 })
    const after = await readState(accountId, true)
    assert.deepEqual(after, full.data)
    assert.equal(after.resources.find((row) => row.id === linkedPerson.id)?.id, linkedPerson.id)
    const memberResource = await db
      .from('account_member_resources')
      .where('account_id', accountId)
      .first()
    assert.equal(memberResource?.resource_id, linkedPerson.id)
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, action: 'import' }),
      1
    )
    assert.equal(await revision(), baseRevision + 1)
  })

  test('wrong document, revision, company and action cannot spend the proof', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client)
    const full = await document()
    const baseRevision = await revision()
    const actionProof = await proof(client, cookie, { baseRevision, document: full })
    const other = structuredClone(full)
    other.data.accounts[0]!.name += ' changed'
    const wrongDocument = await apply(client, cookie, other, baseRevision, actionProof)
    wrongDocument.assertStatus(403)
    const wrongRevision = await apply(client, cookie, full, baseRevision + 1, actionProof)
    wrongRevision.assertStatus(403)
    const wrongAction = await proof(client, cookie, {}, 'anonymise')
    const wrongProof = await apply(client, cookie, full, baseRevision, wrongAction)
    wrongProof.assertStatus(403)
    const wrongCompany = await asDataOwner(client.post('/api/transfer/apply'), cookie)
      .json({ accountId: 'a-loft', document: full, baseRevision, proofId: actionProof })
      .send()
    wrongCompany.assertStatus(403)
    assert.deepEqual(await readState(accountId, true), full.data)
    const valid = await apply(client, cookie, full, baseRevision, actionProof)
    valid.assertStatus(200)
  })

  test('stale revision, redaction and dangling member links leave data unchanged', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client)
    const full = await document()
    const before = await readState(accountId, true)
    const baseRevision = await revision()
    const staleProof = await proof(client, cookie, { baseRevision, document: full })
    await withTransaction((trx) =>
      trx
        .table('company_planning_revisions')
        .insert({ account_id: accountId, revision: baseRevision + 1 })
    )
    const stale = await apply(client, cookie, full, baseRevision, staleProof)
    stale.assertStatus(409)
    const staleProofRow = await db.from('action_proofs').where('id', staleProof).first()
    assert.isNull(staleProofRow?.consumed_at)
    const redacted = buildBetaExport(before, { accountId, completeness: 'redacted' })
    const redactedProof = await proof(client, cookie, {
      baseRevision: baseRevision + 1,
      document: redacted,
    })
    const redactedResponse = await apply(client, cookie, redacted, baseRevision + 1, redactedProof)
    redactedResponse.assertStatus(400)
    await db.table('account_member_resources').insert({
      id: 'link-person-dangling',
      account_id: accountId,
      user_id: userId,
      resource_id: 'missing-resource',
      revision: 'test',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    const danglingProof = await proof(client, cookie, {
      baseRevision: baseRevision + 1,
      document: full,
    })
    const dangling = await apply(client, cookie, full, baseRevision + 1, danglingProof)
    dangling.assertStatus(400)
    assert.deepEqual(await readState(accountId, true), before)
  })

  test('a midway insertion failure rolls back rows, audit, revision and proof consumption', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client)
    const full = await document()
    full.data.accounts[0]!.name += ' changed'
    const before = await readState(accountId, true)
    const baseRevision = await revision()
    const actionProof = await proof(client, cookie, { baseRevision, document: full })
    await db.rawQuery(
      "CREATE TRIGGER fail_transfer_insert BEFORE INSERT ON allocations BEGIN SELECT RAISE(ABORT, 'forced transfer failure'); END"
    )
    try {
      const failed = await apply(client, cookie, full, baseRevision, actionProof)
      assert.isAtLeast(failed.status(), 500)
      assert.deepEqual(await readState(accountId, true), before)
      assert.equal(await revision(), baseRevision)
      assert.lengthOf(
        await db.from('audit_entries').where({ account_id: accountId, action: 'import' }),
        0
      )
      const failedProofRow = await db.from('action_proofs').where('id', actionProof).first()
      assert.isNull(failedProofRow?.consumed_at)
    } finally {
      await db.rawQuery('DROP TRIGGER IF EXISTS fail_transfer_insert')
    }
    const retry = await apply(client, cookie, full, baseRevision, actionProof)
    retry.assertStatus(200)
  })

  test('wrong password, role loss and revoked session cannot authorize import', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client)
    const full = await document()
    const baseRevision = await revision()
    const denied = await asDataOwner(client.post('/api/auth/action-proof/password'), cookie)
      .json({
        action: 'import',
        accountId,
        intent: { baseRevision, document: full },
        password: 'incorrect-password',
      })
      .send()
    denied.assertStatus(403)
    assert.lengthOf(await db.from('action_proofs'), 0)

    const roleProof = await proof(client, cookie, { baseRevision, document: full })
    await db
      .from('memberships')
      .where({ account_id: accountId, user_id: userId })
      .update({ role: 'admin' })
    const roleDenied = await apply(client, cookie, full, baseRevision, roleProof)
    roleDenied.assertStatus(403)
    const roleProofRow = await db.from('action_proofs').where('id', roleProof).first()
    assert.isNull(roleProofRow?.consumed_at)

    await db
      .from('memberships')
      .where({ account_id: accountId, user_id: userId })
      .update({ role: 'owner' })
    const sessionProof = await proof(client, cookie, { baseRevision, document: full })
    await db.from('user_session_index').where('user_id', userId).delete()
    const sessionDenied = await apply(client, cookie, full, baseRevision, sessionProof)
    sessionDenied.assertStatus(401)
    const sessionProofRow = await db.from('action_proofs').where('id', sessionProof).first()
    assert.isNull(sessionProofRow?.consumed_at)
    assert.equal(await revision(), baseRevision)
  })

  test('competing spends admit only one use of an exact import proof', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client)
    const full = await document()
    const baseRevision = await revision()
    const actionProof = await proof(client, cookie, { baseRevision, document: full })
    const responses = await Promise.all([
      apply(client, cookie, full, baseRevision, actionProof),
      apply(client, cookie, full, baseRevision, actionProof),
    ])
    assert.deepEqual(responses.map((response) => response.status()).sort(), [200, 403])
    assert.equal(await revision(), baseRevision)
  })
})
