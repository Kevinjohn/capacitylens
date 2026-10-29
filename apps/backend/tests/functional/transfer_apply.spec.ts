import { test } from '@japa/runner';
import { randomUUID } from 'node:crypto';
import db from '@adonisjs/lucid/services/db';
import { buildBetaExport, type BetaExportDocument } from '@capacitylens/shared/data/betaTransfer';
import { readState } from '#services/state_repository';
import { getPlanningRevision } from '#services/planning_revision';
import { withTransaction } from '#services/with_transaction';
import hash from '@adonisjs/core/services/hash';
import { seed } from '@capacitylens/shared/data/seed';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
  resetAuthenticatedData,
} from '../helpers/authenticated_data_fixture.js';
import { freshDatabase } from '../helpers/fresh_database.js';
import type { ApiClient } from '@japa/api-client';
import { signIn } from '../helpers/identities.js';

const accountId = 'a-studio';
const password = 'fixture-password-2026';

async function document() {
  return buildBetaExport(await readState(accountId, true), { accountId, completeness: 'full' });
}

async function revision() {
  return withTransaction((trx) => getPlanningRevision(trx, accountId));
}

async function deleteForRestoration(client: ApiClient, cookie: string, companyId = accountId) {
  const state = await readState(companyId, true);
  const allocation = state.allocations[0];
  if (!allocation) throw new Error('The restoration fixture has no allocation.');
  const baseRevision = await withTransaction((trx) => getPlanningRevision(trx, companyId));
  const mutationId = randomUUID();
  const response = await asDataOwner(
    client.post(`/api/accounts/${companyId}/allocations/${allocation.id}/delete`),
    cookie
  )
    .json({
      mutationId,
      baseRevision,
      intent: { operation: 'allocation.delete', id: allocation.id },
    })
    .send();
  response.assertStatus(200);
  const body = response.body() as {
    restoration: { replacementGroupId: string };
  };
  return { groupId: body.restoration.replacementGroupId, mutationId, allocationId: allocation.id };
}

async function proof(client: ApiClient, cookie: string, intent: unknown, action = 'import') {
  const result = await asDataOwner(client.post('/api/auth/action-proof/password'), cookie)
    .json({ action, accountId, intent, password })
    .send();
  result.assertStatus(200);
  return (result.body() as { proofId: string }).proofId;
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
    .send();
}

test.group('beta transfer apply', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await db.from('account_member_resources').delete();
  });

  test('restores a full source export into a fresh company and retains destination authority', async ({
    client,
    assert,
  }) => {
    const full = buildBetaExport(seed(), { accountId: 'a-loft', completeness: 'full' });
    const original = structuredClone(full);
    const { cookie, userId } = await resetAuthenticatedData(client, false);
    await createFixtureCompanyForOwner(userId, 'Wayne Enterprises', accountId);
    const memberships = await db.from('memberships').select('*');
    const identities = await db.from('users').select('*');
    const admissions = await db.from('account_admissions').select('*');
    const preview = await asDataOwner(client.post('/api/transfer/preview'), cookie)
      .json({ accountId, document: full })
      .send();
    preview.assertStatus(200);
    const baseRevision = (preview.body() as { baseRevision: number }).baseRevision;
    const actionProof = await proof(client, cookie, { baseRevision, document: full });
    const result = await apply(client, cookie, full, baseRevision, actionProof);
    result.assertStatus(200);
    assert.deepInclude(result.body(), { changed: true, revision: baseRevision + 1 });
    const expected = structuredClone(full.data);
    expected.accounts[0]!.id = accountId;
    for (const key of [
      'clients',
      'disciplines',
      'projects',
      'phases',
      'resources',
      'activities',
      'allocations',
      'timeOff',
      'closures',
    ] as const) {
      for (const row of expected[key]) row.accountId = accountId;
    }
    assert.deepEqual(await readState(accountId, true), expected);
    assert.deepEqual(await db.from('memberships').select('*'), memberships);
    assert.deepEqual(await db.from('users').select('*'), identities);
    assert.deepEqual(await db.from('account_admissions').select('*'), admissions);
    assert.deepEqual(full, original);
    const repeatPreview = await asDataOwner(client.post('/api/transfer/preview'), cookie)
      .json({ accountId, document: full })
      .send();
    repeatPreview.assertStatus(200);
    assert.isFalse((repeatPreview.body() as { changed: boolean }).changed);
  });

  test('requires exact action proof even immediately after owner sign-in', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const full = await document();
    const baseRevision = await revision();
    const missing = await apply(client, cookie, full, baseRevision);
    missing.assertStatus(403);
    const validProof = await proof(client, cookie, { baseRevision, document: full });
    const unchanged = await apply(client, cookie, full, baseRevision, validProof);
    unchanged.assertStatus(200);
    assert.deepInclude(unchanged.body(), { changed: false, revision: baseRevision });
    const again = await apply(client, cookie, full, baseRevision, validProof);
    again.assertStatus(403);
    assert.equal(await revision(), baseRevision);
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, action: 'import' }),
      0
    );
  });

  test('previews and applies changed data with stable IDs, links, one revision and one audit', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client);
    const full = await document();
    full.data.accounts[0]!.name += ' confirmed';
    const before = await readState(accountId, true);
    const linkedPerson = before.resources.find((row) => row.kind === 'person')!;
    await db.table('account_member_resources').insert({
      id: 'link-bruce-person',
      account_id: accountId,
      user_id: userId,
      resource_id: linkedPerson.id,
      revision: 'test',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const preview = await asDataOwner(client.post('/api/transfer/preview'), cookie)
      .json({ accountId, document: full })
      .send();
    preview.assertStatus(200);
    assert.equal((preview.body() as { changed: boolean }).changed, true);
    const baseRevision = (preview.body() as { baseRevision: number }).baseRevision;
    const actionProof = await proof(client, cookie, { baseRevision, document: full });
    const result = await apply(client, cookie, full, baseRevision, actionProof);
    result.assertStatus(200);
    assert.deepInclude(result.body(), { changed: true, revision: baseRevision + 1 });
    const after = await readState(accountId, true);
    assert.deepEqual(after, full.data);
    assert.equal(after.resources.find((row) => row.id === linkedPerson.id)?.id, linkedPerson.id);
    const memberResource = await db
      .from('account_member_resources')
      .where('account_id', accountId)
      .first();
    assert.equal(memberResource?.resource_id, linkedPerson.id);
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, action: 'import' }),
      1
    );
    assert.equal(await revision(), baseRevision + 1);
  });

  test('invalidates only this company restoration while preserving other company and authority records', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client);
    const selected = await document();
    selected.data.accounts[0]!.name += ' restored';
    const selectedDelete = await deleteForRestoration(client, cookie);
    const foreignDelete = await deleteForRestoration(client, cookie, 'a-loft');
    const now = new Date().toISOString();
    await db.table('account_invitations').insert({
      email: 'diana.prince@wayne.example',
      role: 'viewer',
      token_hash: 'invitation-transfer',
      expires_at: now,
      created_at: now,
      updated_at: now,
    });
    await db.table('account_access_restrictions').insert({
      id: 'restriction-transfer',
      account_id: accountId,
      principal_id: 'restricted-principal',
      verified_email: null,
      role: 'viewer',
      created_at: now,
    });
    const foreignBefore = await readState('a-loft', true);
    const preservedTables = [
      'memberships',
      'account_invitations',
      'account_admissions',
      'account_access_restrictions',
      'planning_mutations',
    ] as const;
    const before = await Promise.all(preservedTables.map((table) => db.from(table).select('*')));
    const baseRevision = await revision();
    const actionProof = await proof(client, cookie, { baseRevision, document: selected });
    const result = await apply(client, cookie, selected, baseRevision, actionProof);
    result.assertStatus(200);
    assert.deepInclude(result.body(), { changed: true, revision: baseRevision + 1 });
    assert.isNull(
      await db.from('deleted_groups').where('group_id', selectedDelete.groupId).first()
    );
    assert.lengthOf(await db.from('deleted_rows').where('group_id', selectedDelete.groupId), 0);
    assert.isDefined(
      await db.from('deleted_groups').where('group_id', foreignDelete.groupId).first()
    );
    assert.deepEqual(await readState('a-loft', true), foreignBefore);
    for (const [index, table] of preservedTables.entries())
      assert.deepEqual(await db.from(table).select('*'), before[index]);
    assert.isDefined(
      await db
        .from('planning_mutations')
        .where({
          account_id: accountId,
          mutation_id: selectedDelete.mutationId,
          actor_id: userId,
        })
        .first()
    );
    const restore = await asDataOwner(
      client.post(`/api/accounts/${accountId}/planning/restore-group`),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: baseRevision + 1,
        intent: { operation: 'planning.restoreGroup', restorationGroupId: selectedDelete.groupId },
      })
      .send();
    restore.assertStatus(409);
    const selectedAfter = await readState(accountId, true);
    assert.deepEqual(
      selectedAfter.allocations.find((row) => row.id === selectedDelete.allocationId),
      selected.data.allocations.find((row) => row.id === selectedDelete.allocationId)
    );
    const importedRow = await db
      .from('allocations')
      .where('id', selectedDelete.allocationId)
      .first();
    assert.isDefined(importedRow);
    assert.isNull(importedRow.deleted_at);
    assert.isNull(importedRow.deletion_group_id);
  });

  test('wrong document, revision, company and action cannot spend the proof', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const full = await document();
    const baseRevision = await revision();
    const actionProof = await proof(client, cookie, { baseRevision, document: full });
    const other = structuredClone(full);
    other.data.accounts[0]!.name += ' changed';
    const wrongDocument = await apply(client, cookie, other, baseRevision, actionProof);
    wrongDocument.assertStatus(403);
    const wrongRevision = await apply(client, cookie, full, baseRevision + 1, actionProof);
    wrongRevision.assertStatus(403);
    const wrongAction = await proof(client, cookie, {}, 'anonymise');
    const wrongProof = await apply(client, cookie, full, baseRevision, wrongAction);
    wrongProof.assertStatus(403);
    const wrongCompany = await asDataOwner(client.post('/api/transfer/apply'), cookie)
      .json({ accountId: 'a-loft', document: full, baseRevision, proofId: actionProof })
      .send();
    wrongCompany.assertStatus(403);
    assert.deepEqual(await readState(accountId, true), full.data);
    const valid = await apply(client, cookie, full, baseRevision, actionProof);
    valid.assertStatus(200);
  });

  test('accepts a beta document above one MiB through preview, proof and apply', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const full = await document();
    const template = full.data.disciplines[0];
    if (!template) throw new Error('The large transfer fixture has no discipline.');
    for (let index = 0; index < 7000; index++) {
      full.data.disciplines.push({
        ...template,
        id: `large-discipline-${index}`,
        name: `Gotham design discipline ${index} ${'x'.repeat(50)}`,
      });
    }
    const bytes = Buffer.byteLength(JSON.stringify(full));
    assert.isAbove(bytes, 1024 * 1024);
    assert.isBelow(bytes, 5 * 1024 * 1024);
    const preview = await asDataOwner(client.post('/api/transfer/preview'), cookie)
      .json({ accountId, document: full })
      .send();
    preview.assertStatus(200);
    const baseRevision = (preview.body() as { baseRevision: number }).baseRevision;
    const actionProof = await proof(client, cookie, { baseRevision, document: full });
    const result = await apply(client, cookie, full, baseRevision, actionProof);
    result.assertStatus(200);
    const after = await readState(accountId, true);
    assert.equal(after.disciplines.length, full.data.disciplines.length);
  });

  test('stale revision, redaction and dangling member links leave data unchanged', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client);
    const full = await document();
    const before = await readState(accountId, true);
    const baseRevision = await revision();
    const staleProof = await proof(client, cookie, { baseRevision, document: full });
    await withTransaction((trx) =>
      trx
        .table('company_planning_revisions')
        .insert({ account_id: accountId, revision: baseRevision + 1 })
    );
    const stale = await apply(client, cookie, full, baseRevision, staleProof);
    stale.assertStatus(409);
    const staleProofRow = await db.from('action_proofs').where('id', staleProof).first();
    assert.isNull(staleProofRow?.consumed_at);
    const redacted = buildBetaExport(before, { accountId, completeness: 'redacted' });
    const redactedProof = await proof(client, cookie, {
      baseRevision: baseRevision + 1,
      document: redacted,
    });
    const redactedResponse = await apply(client, cookie, redacted, baseRevision + 1, redactedProof);
    redactedResponse.assertStatus(400);
    await db.table('account_member_resources').insert({
      id: 'link-person-dangling',
      account_id: accountId,
      user_id: userId,
      resource_id: 'missing-resource',
      revision: 'test',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const danglingProof = await proof(client, cookie, {
      baseRevision: baseRevision + 1,
      document: full,
    });
    const dangling = await apply(client, cookie, full, baseRevision + 1, danglingProof);
    dangling.assertStatus(400);
    assert.deepEqual(await readState(accountId, true), before);
  });

  test('a post-cleanup audit failure rolls back rows, restoration, marker and proof', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const deletion = await deleteForRestoration(client, cookie);
    const full = await document();
    full.data.accounts[0]!.name += ' changed';
    const before = await readState(accountId, true);
    const groupBefore = await db.from('deleted_groups').where('group_id', deletion.groupId).first();
    const rowsBefore = await db.from('deleted_rows').where('group_id', deletion.groupId);
    const retainedBefore = await db.from('allocations').where('id', deletion.allocationId).first();
    const markerBefore = await db
      .from('planning_mutations')
      .where({
        account_id: accountId,
        mutation_id: deletion.mutationId,
      })
      .first();
    const baseRevision = await revision();
    assert.isNotNull(retainedBefore.deleted_at);
    assert.equal(retainedBefore.deletion_group_id, deletion.groupId);
    const actionProof = await proof(client, cookie, { baseRevision, document: full });
    await db.rawQuery(
      "CREATE TRIGGER fail_transfer_audit BEFORE INSERT ON audit_entries WHEN NEW.action = 'import' BEGIN SELECT RAISE(ABORT, 'forced transfer failure'); END"
    );
    try {
      const failed = await apply(client, cookie, full, baseRevision, actionProof);
      assert.isAtLeast(failed.status(), 500);
      assert.deepEqual(await readState(accountId, true), before);
      assert.deepEqual(
        await db.from('deleted_groups').where('group_id', deletion.groupId).first(),
        groupBefore
      );
      assert.deepEqual(
        await db.from('deleted_rows').where('group_id', deletion.groupId),
        rowsBefore
      );
      assert.deepEqual(
        await db.from('allocations').where('id', deletion.allocationId).first(),
        retainedBefore
      );
      assert.deepEqual(
        await db
          .from('planning_mutations')
          .where({
            account_id: accountId,
            mutation_id: deletion.mutationId,
          })
          .first(),
        markerBefore
      );
      assert.equal(await revision(), baseRevision);
      assert.lengthOf(
        await db.from('audit_entries').where({ account_id: accountId, action: 'import' }),
        0
      );
      const failedProofRow = await db.from('action_proofs').where('id', actionProof).first();
      assert.isNull(failedProofRow?.consumed_at);
    } finally {
      await db.rawQuery('DROP TRIGGER IF EXISTS fail_transfer_audit');
    }
    const retry = await apply(client, cookie, full, baseRevision, actionProof);
    retry.assertStatus(200);
  });

  test('wrong password, role loss and revoked session cannot authorize import', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client);
    const full = await document();
    const baseRevision = await revision();
    const denied = await asDataOwner(client.post('/api/auth/action-proof/password'), cookie)
      .json({
        action: 'import',
        accountId,
        intent: { baseRevision, document: full },
        password: 'incorrect-password',
      })
      .send();
    denied.assertStatus(403);
    assert.lengthOf(await db.from('action_proofs'), 0);

    const roleProof = await proof(client, cookie, { baseRevision, document: full });
    await db
      .from('memberships')
      .where({ account_id: accountId, user_id: userId })
      .update({ role: 'admin' });
    const roleDenied = await apply(client, cookie, full, baseRevision, roleProof);
    roleDenied.assertStatus(403);
    const roleProofRow = await db.from('action_proofs').where('id', roleProof).first();
    assert.isNull(roleProofRow?.consumed_at);

    await db
      .from('memberships')
      .where({ account_id: accountId, user_id: userId })
      .update({ role: 'owner' });
    const sessionProof = await proof(client, cookie, { baseRevision, document: full });
    await db.from('account_sessions').where('user_id', userId).delete();
    const sessionDenied = await apply(client, cookie, full, baseRevision, sessionProof);
    sessionDenied.assertStatus(401);
    // A proof belongs to its sign-in and is removed with it.
    assert.isNull(await db.from('action_proofs').where('id', sessionProof).first());
    assert.equal(await revision(), baseRevision);
  });

  test('credential replacement during verification cannot mint a proof', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client);
    const full = await document();
    const baseRevision = await revision();
    const priorCredential = await db.from('users').where('id', userId).select('password').first();
    if (!priorCredential?.password) throw new Error('The owner fixture has no password hash.');
    const replacement = await hash.make('replacement-password-2026');
    const originalVerify = hash.verify;
    let replaced = false;
    hash.verify = async function (...args: Parameters<typeof hash.verify>) {
      const result = await originalVerify.apply(this, args);
      if (!replaced) {
        replaced = true;
        await db.from('users').where('id', userId).update({ password: replacement });
      }
      return result;
    };
    try {
      const response = await asDataOwner(client.post('/api/auth/action-proof/password'), cookie)
        .json({ action: 'import', accountId, intent: { baseRevision, document: full }, password })
        .send();
      assert.include([401, 403], response.status());
      assert.isTrue(replaced);
      assert.lengthOf(await db.from('action_proofs').where('user_id', userId), 0);
    } finally {
      hash.verify = originalVerify;
      await db.from('users').where('id', userId).update({ password: priorCredential.password });
    }
  });

  test('another live session and an expired proof cannot spend the same import confirmation', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const full = await document();
    const baseRevision = await revision();
    const actionProof = await proof(client, cookie, { baseRevision, document: full });
    const { cookie: secondCookie } = await signIn(client, 'bruce.wayne@wayne.example', password);
    const wrongSession = await apply(client, secondCookie, full, baseRevision, actionProof);
    wrongSession.assertStatus(403);
    const unspent = await db.from('action_proofs').where('id', actionProof).first();
    assert.isNull(unspent?.consumed_at);
    await db
      .from('action_proofs')
      .where('id', actionProof)
      .update({
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });
    const expired = await apply(client, cookie, full, baseRevision, actionProof);
    expired.assertStatus(403);
    assert.equal(await revision(), baseRevision);
  });

  test('competing spends admit only one use of an exact import proof', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const full = await document();
    const baseRevision = await revision();
    const actionProof = await proof(client, cookie, { baseRevision, document: full });
    const responses = await Promise.all([
      apply(client, cookie, full, baseRevision, actionProof),
      apply(client, cookie, full, baseRevision, actionProof),
    ]);
    assert.deepEqual(responses.map((response) => response.status()).sort(), [200, 403]);
    assert.equal(await revision(), baseRevision);
  });
});
