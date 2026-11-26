import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import User from '#models/user';
import limiter from '@adonisjs/limiter/services/main';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import {
  E_ACCOUNT_KIT_DELIVERY,
  E_ACCOUNT_KIT_REGISTRATION_EMAIL_ALREADY_REGISTERED,
} from '@kevinjohn/adonisjs-account-kit/errors';
import env from '#start/env';
import { resetState } from '#tests/helpers/state_fixture';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { asDataOwner, asLoggedInDataOwner } from '#tests/helpers/authenticated_data_fixture';
import { bootstrapInvitation, rememberSessionCookie } from '#tests/helpers/identities';
import { captureMail, clearIdentities, signIn, expectStatus } from '#tests/helpers/identities';
import { requestBarrier } from '#tests/helpers/request_barrier';
import {
  companyId,
  owner,
  invitee,
  company,
  member,
  invite,
  accept,
  failedFields,
  revision,
} from '#tests/helpers/auth/invitations';

test.group('company invitations', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await clearIdentities();
    await limiter.clear();
  });

  test('an emailed invitation previews without spending, accepts once into its role and waits for approval', async ({
    client,
    assert,
    cleanup,
  }) => {
    const mail = captureMail(cleanup);
    const ownerUser = await User.findOrFail(await company());
    const { cookie } = await signIn(client, owner);
    const sent = await invite(client, cookie, 'Clark.Kent@Wayne.example');
    sent.assertStatus(201);
    assert.include(sent.body().data, { role: 'editor', preauthEmail: invitee, emailed: true });
    const listed = await asLoggedInDataOwner(
      client.visit('api.invitations.index', { companyId }),
      ownerUser
    ).send();
    assert.deepEqual(
      listed.body().data.invites.map((row: { preauthEmail: string }) => row.preauthEmail),
      [invitee]
    );
    const token = mail.tokenFor(invitee);
    for (let look = 0; look < 2; look++) {
      const preview = await client.visit('api.invitation_links.show', { token }).send();
      preview.assertStatus(200);
      assert.deepEqual(preview.body().data, {
        companyId,
        companyName: 'Wayne Enterprises',
        role: 'editor',
        email: invitee,
      });
    }
    const before = await revision();
    const accepted = await accept(client, token);
    accepted.assertStatus(201);
    const userId = (accepted.body().data as { user: { id: string } }).user.id;
    assert.deepInclude(await db.from('memberships').where('user_id', userId).first(), {
      scope_id: companyId,
      role: 'editor',
      status: 'active',
    });
    assert.equal(await revision(), before + 1);
    assert.isNotNull(
      await db
        .from('audit_entries')
        .where({ action: 'invitation.accepted', actor_id: userId })
        .first()
    );
    // Acceptance confirms the address; company data still waits for an Owner or Admin approval.
    rememberSessionCookie(accepted);
    const inviteeCookie = accepted.cookie('adonis-session')!.value;
    const pending = await asDataOwner(client.visit('api.session.show'), inviteeCookie).send();
    assert.isTrue(pending.body().data.emailVerified);
    assert.isFalse(pending.body().data.admission.admitted);
    const planning = () =>
      asDataOwner(client.visit('api.planning.show', { companyId }), inviteeCookie).send();
    await expectStatus(planning(), 403);
    const approved = await asLoggedInDataOwner(
      client.visit('api.admission_approvals.store', { userId }),
      ownerUser
    ).send();
    approved.assertStatus(200);
    await expectStatus(planning(), 200);
    await expectStatus(accept(client, token), 400);
    await expectStatus(client.visit('api.invitation_links.show', { token }).send(), 404);
  });

  test('a company invitation is stored with its company and one without a company is refused', async ({
    client,
    assert,
    cleanup,
  }) => {
    captureMail(cleanup);
    const ownerId = await company();
    const { cookie } = await signIn(client, owner);
    const sent = await invite(client, cookie, invitee);
    sent.assertStatus(201);
    const stored = await db.from('account_invitations').where('email', invitee);
    assert.lengthOf(stored, 1);
    assert.include(stored[0], { scope: companyId, role: 'editor' });
    // Only the operator issues an invitation without a company; a member's send needs one.
    await assert.rejects(() =>
      accountKit.invitations.send({
        actorId: ownerId,
        email: 'diana.prince@wayne.example',
        role: 'editor',
      })
    );
    await assert.rejects(() =>
      accountKit.invitations.send({
        actorId: ownerId,
        email: 'diana.prince@wayne.example',
        role: 'editor',
        scope: 'a-lexcorp',
      })
    );
    assert.lengthOf(await db.from('account_invitations'), 1);
  });

  test('acceptance joins the invitation company with the invited role; an operator invitation adds nothing', async ({
    client,
    assert,
    cleanup,
  }) => {
    const mail = captureMail(cleanup);
    await company();
    const { cookie } = await signIn(client, owner);
    const sent = await invite(client, cookie, invitee, 'admin');
    sent.assertStatus(201);
    const token = mail.tokenFor(invitee);
    // The operator's invitation carries no company; one acceptance spends both.
    await bootstrapInvitation(invitee);
    assert.lengthOf(await db.from('account_invitations').where('email', invitee), 2);
    const accepted = await accept(client, token);
    accepted.assertStatus(201);
    const userId = (accepted.body().data as { user: { id: string } }).user.id;
    const memberships = await db.from('memberships').where('user_id', userId);
    assert.lengthOf(memberships, 1);
    assert.include(memberships[0], { scope_id: companyId, role: 'admin', status: 'active' });
    assert.isEmpty(await db.from('account_invitations').where('email', invitee));
    await expectStatus(accept(client, token), 400);
  });

  test('the operator invitation alone creates no membership once the company exists', async ({
    client,
    assert,
  }) => {
    await company();
    const accepted = await accept(client, await bootstrapInvitation(invitee));
    accepted.assertStatus(201);
    const userId = (accepted.body().data as { user: { id: string } }).user.id;
    assert.isEmpty(await db.from('memberships').where('user_id', userId));
    assert.isEmpty(
      await db.from('audit_entries').where({ actor_id: userId, action: 'invitation.accepted' })
    );
  });

  test('only Owners and Admins invite, never as Owner, and never without mail', async ({
    client,
    assert,
    cleanup,
  }) => {
    await company();
    await member('diana.prince@wayne.example', 'admin');
    await member('barry.allen@wayne.example', 'editor');
    const { cookie: ownerCookie } = await signIn(client, owner);
    const unavailable = await invite(client, ownerCookie, invitee);
    unavailable.assertStatus(503);
    assert.equal((unavailable.body() as { code?: string }).code, 'MAIL_UNAVAILABLE');
    captureMail(cleanup);
    await expectStatus(invite(client, ownerCookie, invitee, 'owner'), 422);
    const { cookie: editorCookie } = await signIn(client, 'barry.allen@wayne.example');
    await expectStatus(invite(client, editorCookie, invitee), 403);
    const { cookie: adminCookie } = await signIn(client, 'diana.prince@wayne.example');
    await expectStatus(invite(client, adminCookie, invitee, 'admin'), 201);
    await expectStatus(invite(client, ownerCookie, 'diana.prince@wayne.example'), 409);
    assert.lengthOf(await db.from('account_invitations'), 1);
  });

  test('a failed invitation email reports the committed invitation without repeating it', async ({
    client,
    assert,
    cleanup,
  }) => {
    const { mailer } = captureMail(cleanup);
    const ownerUser = await User.findOrFail(await company());
    const { cookie } = await signIn(client, owner);
    mailer.sendLater = async () => {
      throw new Error('The mail transport refused the message.');
    };
    const sent = await invite(client, cookie, invitee);
    sent.assertStatus(202);
    assert.deepEqual(sent.body().data, { committed: true, emailed: false });
    assert.lengthOf(await db.from('account_invitations'), 1);
    const listed = await asLoggedInDataOwner(
      client.visit('api.invitations.index', { companyId }),
      ownerUser
    ).send();
    const { id } = (listed.body() as { data: { invites: { id: number }[] } }).data.invites[0];
    const resent = await asLoggedInDataOwner(
      client.visit('api.invitation_deliveries.store', { companyId, id }),
      ownerUser
    ).send();
    resent.assertStatus(202);
    assert.deepEqual(resent.body().data, { committed: true, emailed: false });
  });

  test('an acceptance whose follow-up failed sends the person to sign in', async ({
    client,
    cleanup,
    assert,
  }) => {
    const original = accountKit.invitations.accept;
    accountKit.invitations.accept = async () => {
      throw new E_ACCOUNT_KIT_DELIVERY('The welcome notification failed.');
    };
    cleanup(() => {
      accountKit.invitations.accept = original;
    });
    const accepted = await accept(client, 'committed-token');
    accepted.assertStatus(202);
    assert.deepEqual(accepted.body().data, { accepted: true, signInRequired: true });
  });

  test('accepting an invitation for an existing identity keeps the product 409 response', async ({
    client,
    cleanup,
    assert,
  }) => {
    const original = accountKit.invitations.accept;
    accountKit.invitations.accept = async () => {
      throw new E_ACCOUNT_KIT_REGISTRATION_EMAIL_ALREADY_REGISTERED();
    };
    cleanup(() => {
      accountKit.invitations.accept = original;
    });

    const response = await accept(client, 'existing-identity-token');

    response.assertStatus(409);
    assert.deepEqual(response.body(), {
      error: 'An account already uses this email. Sign in or reset your password.',
      code: 'EMAIL_IN_USE',
    });
    assert.equal(response.header('cache-control'), 'no-store');
    assert.equal(response.header('referrer-policy'), 'no-referrer');
  });

  test('a malformed invitation id or link token answers the framework validation failure', async ({
    client,
    assert,
  }) => {
    const ownerUser = await User.findOrFail(await company());
    for (const id of ['abc', '0', '1.5', '9007199254740992']) {
      for (const route of ['api.invitation_deliveries.store', 'api.invitations.destroy'] as const) {
        const response = await asLoggedInDataOwner(
          client.visit(route, { companyId, id }),
          ownerUser
        ).send();
        response.assertStatus(422);
        assert.deepEqual(failedFields(response.body()), ['params.id'], `${route} ${id}`);
      }
    }
    const token = 'x'.repeat(513);
    for (const response of [
      await client.visit('api.invitation_links.show', { token }).send(),
      await accept(client, token),
    ]) {
      response.assertStatus(422);
      assert.deepEqual(failedFields(response.body()), ['params.token']);
    }
  });

  test('a resent invitation replaces its link and a revoked one stops working', async ({
    client,
    assert,
    cleanup,
  }) => {
    const mail = captureMail(cleanup);
    const ownerUser = await User.findOrFail(await company());
    const { cookie } = await signIn(client, owner);
    const sent = await invite(client, cookie, invitee);
    const first = mail.tokenFor(invitee);
    const { id } = sent.body().data as { id: number };
    const resent = await asLoggedInDataOwner(
      client.visit('api.invitation_deliveries.store', { companyId, id }),
      ownerUser
    ).send();
    resent.assertStatus(200);
    const second = mail.tokenFor(invitee);
    assert.notEqual(second, first);
    await expectStatus(client.visit('api.invitation_links.show', { token: first }).send(), 404);
    env.set('CAPACITYLENS_MAIL_HOST', '');
    const unavailable = await asLoggedInDataOwner(
      client.visit('api.invitation_deliveries.store', { companyId, id }),
      ownerUser
    ).send();
    unavailable.assertStatus(503);
    assert.equal((unavailable.body() as { code?: string }).code, 'MAIL_UNAVAILABLE');
    env.set('CAPACITYLENS_MAIL_HOST', 'mail.wayne.example');
    await expectStatus(client.visit('api.invitation_links.show', { token: second }).send(), 200);
    const revoked = await asLoggedInDataOwner(
      client.visit('api.invitations.destroy', { companyId, id }),
      ownerUser
    ).send();
    revoked.assertStatus(204);
    await expectStatus(accept(client, second), 400);
    assert.lengthOf(await db.from('users').where('email', invitee), 0);
  });

  test('concurrent acceptances of one link create one identity and one membership', async ({
    client,
    assert,
    cleanup,
  }) => {
    const mail = captureMail(cleanup);
    await company();
    const { cookie } = await signIn(client, owner);
    await invite(client, cookie, invitee);
    const token = mail.tokenFor(invitee);
    const results = await Promise.all([accept(client, token), accept(client, token)]);
    assert.deepEqual(results.map((result) => result.status()).sort(), [201, 400]);
    assert.lengthOf(await db.from('users').where('email', invitee), 1);
    assert.lengthOf(await db.from('memberships').where('scope_id', companyId), 2);
  });

  test('a sender demoted after manager approval cannot insert or email an invitation', async ({
    client,
    assert,
    cleanup,
  }) => {
    const mail = captureMail(cleanup);
    await company();
    const adminId = await member('diana.prince@wayne.example', 'admin');
    const { cookie } = await signIn(client, 'diana.prince@wayne.example');
    const original = accountKit.invitations.send.bind(accountKit.invitations);
    const barrier = requestBarrier();
    accountKit.invitations.send = async (...args) => {
      await barrier.pause();
      return original(...args);
    };
    const audits = await db.from('audit_entries');
    const before = await revision();
    const pending = invite(client, cookie, invitee);
    try {
      await barrier.entered();
      await db.from('memberships').where('user_id', adminId).update({ role: 'viewer' });
      barrier.release();
      const refused = await pending;
      refused.assertStatus(403);
      assert.lengthOf(await db.from('account_invitations'), 0);
      assert.equal(mail.count(invitee), 0);
      assert.equal(await revision(), before);
      assert.deepEqual(await db.from('audit_entries'), audits);
    } finally {
      barrier.release();
      accountKit.invitations.send = original;
      await pending;
    }
  });
});
