import { test } from '@japa/runner';
import type { ApiClient } from '@japa/api-client';
import type { HttpContext } from '@adonisjs/core/http';
import type { Trx } from '@kevinjohn/adonisjs-account-kit/types';
import app from '@adonisjs/core/services/app';
import db from '@adonisjs/lucid/services/db';
import hash from '@adonisjs/core/services/hash';
import proofs from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission';
import { buildBetaExport } from '@capacitylens/shared/data/betaTransfer';
import ActionProofsController from '#controllers/action_proofs_controller';
import { admissionDecision, actorIn, kitContextIn, withActor } from '#services/auth/current_actor';
import {
  captureMasqueradeContext,
  capturedMasqueradeContext,
} from '#services/auth/masquerade_request';
import { withTransaction } from '#services/with_transaction';
import { readState } from '#services/state_repository';
import { getPlanningRevision } from '#services/planning_revision';
import { asDataOwner, resetAuthenticatedData } from '../../helpers/authenticated_data_fixture.js';
import {
  clearIdentities,
  createIdentity,
  fixturePassword,
  signIn,
} from '../../helpers/identities.js';
import { freshDatabase } from '../../helpers/fresh_database.js';

const accountId = 'a-studio';
const required = { error: 'Confirm this action again.', code: 'ACTION_PROOF_REQUIRED' };
const body = { action: 'anonymise', accountId, intent: {}, password: fixturePassword };
function issue(client: ApiClient, cookie: string, input = body) {
  return asDataOwner(client.post('/api/auth/action-proof/password'), cookie).json(input).send();
}

test.group('package proof adoption boundaries', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(() => clearIdentities());

  test('a foreign Origin is refused on password proof issuance', async ({ client, assert }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const response = await asDataOwner(client.post('/api/auth/action-proof/password'), cookie)
      .header('origin', 'https://lex.example')
      .header('sec-fetch-site', 'cross-site')
      .json(body)
      .send();
    response.assertStatus(403);
    assert.deepEqual(response.body(), { error: 'Cross-site request rejected.' });
    assert.lengthOf(await db.from('password_confirmations'), 0);
  });

  for (const gate of ['unverified', 'unadmitted', 'principal mismatch'] as const) {
    test(`issuance preflight refuses ${gate} before package verification`, async ({
      client,
      assert,
      cleanup,
    }) => {
      const { cookie, userId } = await resetAuthenticatedData(client);
      let expected: object = {
        error: 'Masquerade context changed.',
        code: 'MASQUERADE_CONTEXT_CHANGED',
      };
      if (gate === 'unverified') {
        await db.from('users').where('id', userId).update({
          email_verified_at: null,
          unverified_email: 'bruce.wayne@wayne.example',
        });
        expected = {
          error: 'Email verification is required.',
          code: 'E_ACCOUNT_KIT_UNVERIFIED_EMAIL',
        };
      } else if (gate === 'unadmitted') {
        const admission = await app.container.make(AccountAdmission);
        await admission.operator.revoke({ email: 'bruce.wayne@wayne.example' });
        expected = {
          error: 'Your access to this company is waiting on admission.',
          code: 'ADMISSION_REQUIRED',
          decision: await withTransaction((trx) => admissionDecision(userId, trx)),
        };
      }
      const prove = proofs.confirmPassword;
      const controller = ActionProofsController.prototype.password;
      let reached = 0;
      proofs.confirmPassword = async () => {
        throw new Error('Preflight must refuse before package verification.');
      };
      ActionProofsController.prototype.password = function (ctx) {
        reached++;
        if (gate === 'principal mismatch') {
          const captured = capturedMasqueradeContext(ctx);
          if (!captured) throw new Error('The real middleware did not capture a principal.');
          captureMasqueradeContext(ctx, { ...captured, actorId: 'another-principal' });
        }
        return controller.call(this, ctx);
      };
      cleanup(() => {
        proofs.confirmPassword = prove;
        ActionProofsController.prototype.password = controller;
      });
      const response = await issue(client, cookie);
      response.assertStatus(gate === 'principal mismatch' ? 409 : 403);
      assert.deepEqual(response.body(), expected);
      assert.equal(reached, 1, 'the request must reach controller preflight');
      assert.lengthOf(await db.from('password_confirmations'), 0);
    });
  }

  test('wrong passwords exhaust one account across browsers while another account succeeds', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const second = await signIn(client, 'bruce.wayne@wayne.example');
    const other = await createIdentity('clark.kent@wayne.example');
    await db.from('memberships').where('scope_id', 'a-loft').delete();
    const now = new Date().toISOString();
    await db.table('memberships').insert({
      scope_id: 'a-loft',
      user_id: other,
      role: 'owner',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    const browser = await signIn(client, 'clark.kent@wayne.example');
    for (let i = 0; i < 5; i++) {
      const response = await issue(client, i % 2 ? second.cookie : cookie, {
        ...body,
        password: 'wrong',
      });
      response.assertStatus(403);
      assert.deepEqual(response.body(), {
        error: 'Incorrect password.',
        code: 'ACTION_PROOF_DENIED',
      });
    }
    const success = await issue(client, browser.cookie, { ...body, accountId: 'a-loft' });
    success.assertStatus(200);
    const blocked = await issue(client, second.cookie);
    blocked.assertStatus(429);
    assert.deepEqual(blocked.body(), { error: 'Too many attempts. Try again in 20 minutes.' });
    const retryAfter = Number(blocked.header('retry-after'));
    assert.isAbove(retryAfter, 1140);
    assert.isAtMost(retryAfter, 1200);
  });

  test('a prune failure after issue still returns its stored proof outside transactions', async ({
    client,
    assert,
    cleanup,
  }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const original = proofs.prune;
    let called = 0;
    proofs.prune = async () => {
      // This root query would time out if issuance still held the only connection.
      await db.from('password_confirmations').select('id');
      called++;
      throw new Error('PRIVATE_PRUNE_FAILURE');
    };
    cleanup(() => {
      proofs.prune = original;
    });
    const response = await issue(client, cookie);
    response.assertStatus(200);
    assert.deepEqual(Object.keys(response.body()), ['proofId']);
    assert.equal(called, 1);
    const row = await db
      .from('password_confirmations')
      .where('id', response.body().proofId)
      .firstOrFail();
    assert.isNull(row.consumed_at);
  });

  test('admission revoked while password verification is pending refuses issuance', async ({
    client,
    assert,
    cleanup,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client);
    const original = hash.verify;
    const checking = Promise.withResolvers<void>();
    const pending = Promise.withResolvers<void>();
    hash.verify = async function (...args) {
      const result = await original.apply(this, args);
      checking.resolve();
      await pending.promise;
      return result;
    };
    cleanup(() => {
      pending.resolve();
      hash.verify = original;
    });
    const request = issue(client, cookie);
    await checking.promise;
    const admission = await app.container.make(AccountAdmission);
    await admission.operator.revoke({ email: 'bruce.wayne@wayne.example' });
    const decision = await withTransaction((trx) => admissionDecision(userId, trx));
    pending.resolve();
    const response = await request;
    response.assertStatus(403);
    assert.deepEqual(response.body(), {
      error: 'Your access to this company is waiting on admission.',
      code: 'ADMISSION_REQUIRED',
      decision,
    });
    assert.lengthOf(await db.from('password_confirmations').where('user_id', userId), 0);
  });

  test('overlong missing company scopes keep the complete host refusal in request bodies and match no path route', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const scope = 'x'.repeat(256);
    const document = buildBetaExport(await readState(accountId, true), {
      accountId,
      completeness: 'full',
    });
    const baseRevision = await withTransaction((trx) => getPlanningRevision(trx, accountId));
    const responses = [
      await issue(client, cookie, { ...body, accountId: scope }),
      await asDataOwner(client.post('/api/transfer/apply'), cookie)
        .json({ accountId: scope, document, baseRevision, proofId: 'missing' })
        .send(),
    ];
    for (const response of responses) {
      response.assertStatus(403);
      assert.deepEqual(response.body(), required);
    }
    const anonymise = await asDataOwner(client.post(`/api/accounts/${scope}/anonymise`), cookie)
      .json({ proofId: 'missing' })
      .send();
    anonymise.assertStatus(404);
  });

  test('deleting a company cascades only its issued proofs', async ({ client, assert }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const a = await issue(client, cookie);
    const b = await issue(client, cookie, { ...body, accountId: 'a-loft' });
    a.assertStatus(200);
    b.assertStatus(200);
    await db.from('memberships').where('scope_id', accountId).delete();
    await db.from('accounts').where('id', accountId).delete();
    assert.isNull(await db.from('password_confirmations').where('id', a.body().proofId).first());
    const survivor = await db
      .from('password_confirmations')
      .where('id', b.body().proofId)
      .firstOrFail();
    assert.equal(survivor.scope, 'a-loft');
    assert.isNull(survivor.consumed_at);
  });

  test('Kit transaction context is removed after callback completion and interruption', async ({
    client,
    assert,
    cleanup,
  }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const original = ActionProofsController.prototype.password;
    let checked = 0;
    ActionProofsController.prototype.password = async function (ctx: HttpContext) {
      for (const interrupted of [false, true]) {
        let captured: Trx | undefined;
        const sentinel = new Error('INTERRUPTED_CALLBACK');
        try {
          await withActor(ctx, async (actor, trx) => {
            captured = trx;
            assert.equal(String(kitContextIn(trx).account.id), actor.userId);
            assert.equal(kitContextIn(trx).signInId, actor.sessionId);
            assert.strictEqual(kitContextIn(trx).trx, trx);
            if (interrupted) throw sentinel;
          });
        } catch (error) {
          if (error !== sentinel) throw error;
        }
        assert.isDefined(captured);
        assert.throws(() => kitContextIn(captured!), /inside withActor/);
        assert.throws(() => actorIn(captured!), /inside withActor/);
        checked++;
      }
      return original.call(this, ctx);
    };
    cleanup(() => {
      ActionProofsController.prototype.password = original;
    });
    const response = await issue(client, cookie);
    response.assertStatus(200);
    assert.equal(checked, 2);
  });
});
