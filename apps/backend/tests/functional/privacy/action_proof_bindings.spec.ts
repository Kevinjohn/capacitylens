import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import { buildBetaExport } from '@capacitylens/shared/data/betaTransfer';
import { getPlanningRevision } from '#services/planning_revision';
import { readState } from '#services/state_repository';
import { withTransaction } from '#services/with_transaction';
import { asDataOwner, resetAuthenticatedData } from '../../helpers/authenticated_data_fixture.js';
import { freshDatabase } from '../../helpers/fresh_database.js';
import { createIdentity, fixturePassword, signIn } from '../../helpers/identities.js';

const accountId = 'a-studio';

async function revision() {
  return withTransaction((trx) => getPlanningRevision(trx, accountId));
}

test.group('action proof bindings', (group) => {
  group.setup(() => freshDatabase());

  test('a successor Owner cannot spend the previous Owner proof over HTTP', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client);
    const before = await readState(accountId, true);
    const baseRevision = await revision();
    const document = buildBetaExport(before, { accountId, completeness: 'full' });
    document.data.accounts[0]!.name += ' by Lex';
    const issue = async (action: string, intent: unknown) => {
      const response = await asDataOwner(client.post('/api/auth/action-proof/password'), cookie)
        .json({ action, accountId, intent, password: fixturePassword })
        .send();
      response.assertStatus(200);
      return (response.body() as { proofId: string }).proofId;
    };
    const anonymiseProof = await issue('anonymise', {});
    const importProof = await issue('import', { baseRevision, document });

    const successorEmail = `clark.kent.${Date.now()}@wayne.example`;
    const successor = await createIdentity(successorEmail, { name: 'Clark Kent' });
    await db
      .from('memberships')
      .where({ scope_id: accountId, user_id: userId })
      .update({ role: 'admin' });
    const now = new Date().toISOString();
    await db.table('memberships').insert({
      scope_id: accountId,
      user_id: successor,
      role: 'owner',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    const { cookie: successorCookie } = await signIn(client, successorEmail);
    const auditBefore = await db.from('audit_entries').where('account_id', accountId);

    const anonymise = await asDataOwner(
      client.post(`/api/accounts/${accountId}/anonymise`),
      successorCookie
    )
      .json({ proofId: anonymiseProof })
      .send();
    anonymise.assertStatus(403);
    assert.deepEqual(anonymise.body(), {
      error: 'Confirm this action again.',
      code: 'ACTION_PROOF_REQUIRED',
    });
    const imported = await asDataOwner(client.post('/api/transfer/apply'), successorCookie)
      .json({ accountId, document, baseRevision, proofId: importProof })
      .send();
    imported.assertStatus(403);
    assert.deepEqual(imported.body(), {
      error: 'Confirm this action again.',
      code: 'ACTION_PROOF_REQUIRED',
    });

    assert.deepEqual(await readState(accountId, true), before);
    assert.equal(await revision(), baseRevision);
    assert.lengthOf(
      await db.from('audit_entries').where('account_id', accountId),
      auditBefore.length
    );
    assert.lengthOf(
      await db
        .from('password_confirmations')
        .whereIn('id', [anonymiseProof, importProof])
        .whereNull('consumed_at'),
      2
    );
  });

  test('a proof issued for one protected action cannot authorize another route', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const before = await readState(accountId, true);
    const baseRevision = await revision();
    const document = buildBetaExport(before, { accountId, completeness: 'full' });
    const response = await asDataOwner(client.post('/api/auth/action-proof/password'), cookie)
      .json({
        action: 'import',
        accountId,
        intent: { baseRevision, document },
        password: fixturePassword,
      })
      .send();
    response.assertStatus(200);
    const importProof = (response.body() as { proofId: string }).proofId;
    const anonymise = await asDataOwner(client.post(`/api/accounts/${accountId}/anonymise`), cookie)
      .json({ proofId: importProof })
      .send();
    anonymise.assertStatus(403);
    assert.deepEqual(anonymise.body(), {
      error: 'Confirm this action again.',
      code: 'ACTION_PROOF_REQUIRED',
    });
    assert.deepEqual(await readState(accountId, true), before);
    assert.equal(await revision(), baseRevision);
    const unspent = await db.from('password_confirmations').where('id', importProof).first();
    assert.isNull(unspent?.consumed_at);
  });
});
