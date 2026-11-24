import { test } from '@japa/runner';
import type { ApiClient } from '@japa/api-client';
import type { HttpContext } from '@adonisjs/core/http';
import type { Trx } from '@kevinjohn/adonisjs-account-kit/types';
import app from '@adonisjs/core/services/app';
import db from '@adonisjs/lucid/services/db';
import hash from '@adonisjs/core/services/hash';
import proofs from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission';
import { buildCompanyExport } from '@capacitylens/shared/data/companyExport';
import PasswordConfirmationsController from '#controllers/password_confirmations_controller';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { readState } from '#tests/helpers/state_fixture';
import { getPlanningRevision } from '#services/planning_revision';
import { asDataOwner, resetAuthenticatedData } from '#tests/helpers/authenticated_data_fixture';
import {
  clearIdentities,
  createIdentity,
  fixturePassword,
  signIn,
} from '#tests/helpers/identities';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { asExportFile } from '#tests/helpers/export_file';

const companyId = 'a-studio';
const required = { error: 'Confirm this action again.', code: 'PASSWORD_CONFIRMATION_REQUIRED' };
const body = { action: 'anonymise' as const, companyId, intent: {}, password: fixturePassword };
function issue(client: ApiClient, cookie: string, input = body) {
  return asDataOwner(client.visit('api.password_confirmations.store'), cookie).json(input).send();
}

test.group('package proof adoption boundaries', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(() => clearIdentities());

  test('a foreign Origin is refused on password proof issuance', async ({ client, assert }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const response = await asDataOwner(client.visit('api.password_confirmations.store'), cookie)
      .header('origin', 'https://lex.example')
      .header('sec-fetch-site', 'cross-site')
      .json(body)
      .send();
    response.assertStatus(403);
    assert.deepEqual(response.body(), { error: 'Cross-site request rejected.' });
    assert.lengthOf(await db.from('password_confirmations'), 0);
  });

  for (const gate of ['unverified', 'unadmitted'] as const) {
    test(`issuance preflight refuses ${gate} before package verification`, async ({
      client,
      assert,
      cleanup,
    }) => {
      const { cookie, userId } = await resetAuthenticatedData(client);
      let expected: object;
      if (gate === 'unverified') {
        await db.from('users').where('id', userId).update({
          email_verified_at: null,
          unverified_email: 'bruce.wayne@wayne.example',
        });
        expected = {
          error: 'Email verification is required.',
          code: 'E_ACCOUNT_KIT_UNVERIFIED_EMAIL',
        };
      } else {
        const admission = await app.container.make(AccountAdmission);
        await admission.operator.revoke({ email: 'bruce.wayne@wayne.example' });
        const currentActor = await app.container.make(CurrentActorService);
        expected = {
          error: 'Your access to this company is waiting on admission.',
          code: 'ADMISSION_REQUIRED',
          decision: await db.transaction((trx) =>
            currentActor.requireAdmissionDecision(userId, trx)
          ),
        };
      }
      const prove = proofs.confirmPassword;
      const controller = PasswordConfirmationsController.prototype.store;
      let reached = 0;
      proofs.confirmPassword = async () => {
        throw new Error('Preflight must refuse before package verification.');
      };
      PasswordConfirmationsController.prototype.store = function (ctx) {
        reached++;
        return controller.call(this, ctx);
      };
      cleanup(() => {
        proofs.confirmPassword = prove;
        PasswordConfirmationsController.prototype.store = controller;
      });
      const response = await issue(client, cookie);
      response.assertStatus(403);
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
        code: 'PASSWORD_CONFIRMATION_DENIED',
      });
    }
    const success = await issue(client, browser.cookie, { ...body, companyId: 'a-loft' });
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
    assert.deepEqual(Object.keys(response.body().data), ['confirmationId']);
    assert.equal(called, 1);
    const row = await db
      .from('password_confirmations')
      .where('id', response.body().data.confirmationId)
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
    const currentActor = await app.container.make(CurrentActorService);
    const decision = await db.transaction((trx) =>
      currentActor.requireAdmissionDecision(userId, trx)
    );
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
    const document = asExportFile(
      buildCompanyExport(await readState(companyId, true), {
        companyId,
        completeness: 'full',
      })
    );
    const baseRevision = await db.transaction((trx) => getPlanningRevision(trx, companyId));
    const responses = [
      await issue(client, cookie, { ...body, companyId: scope }),
      await asDataOwner(client.visit('api.imports.store'), cookie)
        .json({ companyId: scope, document, baseRevision, confirmationId: 'missing' })
        .send(),
    ];
    for (const response of responses) {
      response.assertStatus(403);
      assert.deepEqual(response.body(), required);
    }
    const anonymise = await asDataOwner(
      client.visit('api.company_anonymisations.store', { companyId: scope }),
      cookie
    )
      .json({ confirmationId: 'missing' })
      .send();
    anonymise.assertStatus(404);
  });

  test('Kit transaction context is removed after callback completion and interruption', async ({
    client,
    assert,
    cleanup,
  }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const original = PasswordConfirmationsController.prototype.store;
    let checked = 0;
    PasswordConfirmationsController.prototype.store = async function (ctx: HttpContext) {
      const currentActor = await app.container.make(CurrentActorService);
      for (const interrupted of [false, true]) {
        let captured: Trx | undefined;
        const sentinel = new Error('INTERRUPTED_CALLBACK');
        try {
          await currentActor.withActor(ctx.auth, async (actor, trx) => {
            captured = trx;
            assert.equal(String(currentActor.requireKitContext(trx).account.id), actor.userId);
            assert.equal(currentActor.requireKitContext(trx).signInId, actor.sessionId);
            assert.strictEqual(currentActor.requireKitContext(trx).trx, trx);
            if (interrupted) throw sentinel;
          });
        } catch (error) {
          if (error !== sentinel) throw error;
        }
        assert.isDefined(captured);
        assert.throws(() => currentActor.requireKitContext(captured!), /inside withActor/);
        assert.throws(() => currentActor.requireActor(captured!), /inside withActor/);
        checked++;
      }
      return original.call(this, ctx);
    };
    cleanup(() => {
      PasswordConfirmationsController.prototype.store = original;
    });
    const response = await issue(client, cookie);
    response.assertStatus(200);
    assert.equal(checked, 2);
  });
});
