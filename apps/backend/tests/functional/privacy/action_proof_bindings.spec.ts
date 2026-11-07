import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import { buildBetaExport } from '@capacitylens/shared/data/betaTransfer';
import {
  ActionProofError,
  consumeActionProof,
  createActionProof,
} from '#services/auth/action_proof';
import type { CurrentActor } from '#services/auth/current_actor';
import { getPlanningRevision } from '#services/planning_revision';
import { readState, resetState } from '#services/state_repository';
import { withTransaction } from '#services/with_transaction';
import { asDataOwner, resetAuthenticatedData } from '../../helpers/authenticated_data_fixture.js';
import { freshDatabase } from '../../helpers/fresh_database.js';
import {
  createIdentity,
  fixturePassword,
  fixtureSession,
  signIn,
} from '../../helpers/identities.js';

const accountId = 'a-studio';

function actor(userId: string, sessionId: number): CurrentActor {
  return {
    userId,
    sessionId,
    email: `${userId}@wayne.example`,
    displayName: null,
    emailVerified: true,
  };
}

async function revision() {
  return withTransaction((trx) => getPlanningRevision(trx, accountId));
}

async function refused(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    if (error instanceof ActionProofError) return true;
    throw error;
  }
  return false;
}

test.group('action proof bindings', (group) => {
  group.setup(() => freshDatabase());

  test('each stored binding independently refuses a spend and a proof spends only once', async ({
    assert,
  }) => {
    await resetState(true);
    await db.from('action_proofs').delete();
    const issuer = await createIdentity(`diana.prince.${Date.now()}@wayne.example`);
    const other = await createIdentity(`barbara.gordon.${Date.now()}@wayne.example`);
    const issuerSession = await fixtureSession(issuer);
    const issuerOtherSession = await fixtureSession(issuer);
    const owner = actor(issuer, issuerSession);
    const intent = { toUserId: other };
    const proofId = await withTransaction((trx) =>
      createActionProof(trx, owner, 'transfer-ownership', accountId, intent)
    );
    const spend = (who: CurrentActor, action = 'transfer-ownership', company = accountId) =>
      refused(() =>
        withTransaction((trx) =>
          consumeActionProof(
            trx,
            who,
            proofId,
            action as 'transfer-ownership' | 'import' | 'anonymise',
            company,
            intent
          )
        )
      );

    // Same session id, another principal: only the user_id binding distinguishes this spend.
    assert.isTrue(await spend(actor(other, issuerSession)), 'another principal');
    // Same principal, another live session of theirs.
    assert.isTrue(await spend(actor(issuer, issuerOtherSession)), 'another session');
    // Same principal, session and intent, another company.
    assert.isTrue(await spend(owner, 'transfer-ownership', 'a-loft'), 'another company');
    // Same principal, session, company and intent, another action.
    assert.isTrue(await spend(owner, 'import'), 'another action');
    assert.isTrue(await spend(owner, 'anonymise'), 'another action');
    const unspent = await db.from('action_proofs').where('id', proofId).first();
    assert.isNull(unspent?.consumed_at);

    assert.isFalse(await spend(owner), 'the exact binding spends');
    assert.isTrue(await spend(owner), 'a second spend');
  });

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
      .from('company_memberships')
      .where({ scope_id: accountId, user_id: userId })
      .update({ role: 'admin' });
    const now = new Date().toISOString();
    await db.table('company_memberships').insert({
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
    assert.equal((anonymise.body() as { code: string }).code, 'ACTION_PROOF_REQUIRED');
    const imported = await asDataOwner(client.post('/api/transfer/apply'), successorCookie)
      .json({ accountId, document, baseRevision, proofId: importProof })
      .send();
    imported.assertStatus(403);
    assert.equal((imported.body() as unknown as { code: string }).code, 'ACTION_PROOF_REQUIRED');

    assert.deepEqual(await readState(accountId, true), before);
    assert.equal(await revision(), baseRevision);
    assert.lengthOf(
      await db.from('audit_entries').where('account_id', accountId),
      auditBefore.length
    );
    assert.lengthOf(
      await db
        .from('action_proofs')
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
    assert.deepEqual(await readState(accountId, true), before);
    assert.equal(await revision(), baseRevision);
    const unspent = await db.from('action_proofs').where('id', importProof).first();
    assert.isNull(unspent?.consumed_at);
  });
});
