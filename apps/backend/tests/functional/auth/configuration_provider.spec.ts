import { test } from '@japa/runner';
import app from '@adonisjs/core/services/app';
import db from '@adonisjs/lucid/services/db';
import env from '#start/env';
import { setSecretSetting } from '#tests/helpers/secret_settings';
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission';
import ConfigurationProvider from '#providers/configuration_provider';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { asDataOwner } from '#tests/helpers/authenticated_data_fixture';
import { clearIdentities, createIdentity, signIn } from '#tests/helpers/identities';
import { execCommand } from '#tests/helpers/auth/commands';

const bootstrapEmail = 'admin@admin.admin';
const bootstrapPassword = 'batman-local-bootstrap-2026';
const originalCreateAdmin = env.get('CAPACITYLENS_CREATE_ADMIN_ADMIN');
const originalBootstrapPassword = env.get('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD');

test.group('development bootstrap provider recovery', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await clearIdentities();
    env.set('CAPACITYLENS_CREATE_ADMIN_ADMIN', false);
    setSecretSetting('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD', undefined);
  });
  group.each.teardown(async () => {
    await clearIdentities();
    env.set('CAPACITYLENS_CREATE_ADMIN_ADMIN', originalCreateAdmin ?? false);
    setSecretSetting('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD', originalBootstrapPassword?.release());
  });

  test('empty installation creates one admitted identity and restart keeps its password', async ({
    client,
    assert,
  }) => {
    env.set('CAPACITYLENS_CREATE_ADMIN_ADMIN', true);
    setSecretSetting('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD', bootstrapPassword);
    const provider = new ConfigurationProvider(app);
    await provider.start();
    const rows = await db.from('users').where('email', bootstrapEmail);
    assert.lengthOf(rows, 1);
    const passwordHash = rows[0]!.password;
    const admission = await app.container.make(AccountAdmission);
    assert.isTrue(await admission.isAdmitted(rows[0]!.id));

    await provider.start();
    const restartedUsers = await db.from('users').where('email', bootstrapEmail);
    assert.equal(restartedUsers.length, 1);
    assert.equal(
      (await db.from('users').where('email', bootstrapEmail).first())!.password,
      passwordHash
    );
    const session = await signIn(client, bootstrapEmail, bootstrapPassword);
    const status = await asDataOwner(client.visit('api.admission.show'), session.cookie).send();
    status.assertStatus(200);
    assert.isTrue(status.body().data.decision.admitted);
  });

  test('an unrelated existing identity at the configured address is never adopted or changed', async ({
    assert,
  }) => {
    const identityId = await createIdentity(bootstrapEmail, {
      name: 'Bruce Wayne',
      password: bootstrapPassword,
      admitted: false,
    });
    const before = await db.from('users').where('id', identityId).first();
    env.set('CAPACITYLENS_CREATE_ADMIN_ADMIN', true);
    setSecretSetting('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD', 'different-local-password-2026');
    await assert.rejects(
      () => new ConfigurationProvider(app).start(),
      /Verify this is the identity/
    );

    const after = await db.from('users').where('id', identityId).first();
    assert.equal(after.id, before.id);
    assert.equal(after.password, before.password);
    const admission = await app.container.make(AccountAdmission);
    const identityAdmitted = await admission.isAdmitted(identityId);
    const usersAfterRefusal = await db.from('users');
    assert.isFalse(identityAdmitted);
    assert.equal(usersAfterRefusal.length, 1);
  });

  test('an interrupted admission completes only through verified operator recovery and restart', async ({
    client,
    assert,
  }) => {
    const identityId = await createIdentity(bootstrapEmail, {
      name: 'Bruce Wayne',
      password: bootstrapPassword,
      admitted: false,
    });
    const before = await db.from('users').where('id', identityId).first();
    const admission = await app.container.make(AccountAdmission);
    await admission.operator.grantInvitation({ email: bootstrapEmail, role: 'admin' });

    env.set('CAPACITYLENS_CREATE_ADMIN_ADMIN', true);
    setSecretSetting('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD', bootstrapPassword);
    const provider = new ConfigurationProvider(app);
    await assert.rejects(() => provider.start(), /Verify this is the identity/);
    assert.isFalse(await admission.isAdmitted(identityId));

    env.set('CAPACITYLENS_CREATE_ADMIN_ADMIN', false);
    await provider.start();
    const session = await signIn(client, bootstrapEmail, bootstrapPassword);
    const status = await asDataOwner(client.visit('api.admission.show'), session.cookie).send();
    status.assertStatus(200);
    const decision = (
      status.body().data as {
        decision: { requirements: { invitation: { met: boolean }; approval: { met: boolean } } };
      }
    ).decision;
    assert.isTrue(decision.requirements.invitation.met);
    assert.isFalse(decision.requirements.approval.met);

    const approvalCommand = await execCommand('account-kit:admission:approve', [bootstrapEmail]);
    approvalCommand.assertSucceeded();
    env.set('CAPACITYLENS_CREATE_ADMIN_ADMIN', true);
    await provider.start();
    assert.isTrue(await admission.isAdmitted(identityId));
    const after = await db.from('users').where('id', identityId).first();
    assert.equal(after.password, before.password);
    const usersAfterRecovery = await db.from('users');
    assert.equal(usersAfterRecovery.length, 1);
  });

  test('the supported operator commands recover an identity left before invitation evidence', async ({
    client,
    assert,
  }) => {
    const identityId = await createIdentity(bootstrapEmail, {
      name: 'Bruce Wayne',
      password: bootstrapPassword,
      admitted: false,
    });
    const before = await db.from('users').where('id', identityId).first();
    env.set('CAPACITYLENS_CREATE_ADMIN_ADMIN', true);
    setSecretSetting('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD', bootstrapPassword);
    const provider = new ConfigurationProvider(app);
    await assert.rejects(() => provider.start(), /Verify this is the identity/);

    env.set('CAPACITYLENS_CREATE_ADMIN_ADMIN', false);
    await provider.start();
    const session = await signIn(client, bootstrapEmail, bootstrapPassword);
    const status = await asDataOwner(client.visit('api.admission.show'), session.cookie).send();
    status.assertStatus(200);
    const decision = (
      status.body().data as {
        decision: { requirements: { invitation: { met: boolean }; approval: { met: boolean } } };
      }
    ).decision;
    assert.isFalse(decision.requirements.invitation.met);
    assert.isFalse(decision.requirements.approval.met);

    const invitationCommand = await execCommand('account-kit:admission:grant-invitation', [
      bootstrapEmail,
      '--role=admin',
    ]);
    invitationCommand.assertSucceeded();
    const approvalCommand = await execCommand('account-kit:admission:approve', [bootstrapEmail]);
    approvalCommand.assertSucceeded();
    env.set('CAPACITYLENS_CREATE_ADMIN_ADMIN', true);
    await provider.start();
    const admission = await app.container.make(AccountAdmission);
    const identityAdmitted = await admission.isAdmitted(identityId);
    assert.isTrue(identityAdmitted);
    const after = await db.from('users').where('id', identityId).first();
    assert.equal(after.password, before.password);
    const usersAfterRecovery = await db.from('users');
    assert.equal(usersAfterRecovery.length, 1);
  });

  test('another-address and populated installations remain untouched', async ({ assert }) => {
    const otherId = await createIdentity('clark.kent@wayne.example', {
      name: 'Clark Kent',
      password: bootstrapPassword,
      admitted: false,
    });
    const before = await db.from('users').where('id', otherId).first();
    env.set('CAPACITYLENS_CREATE_ADMIN_ADMIN', true);
    setSecretSetting('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD', bootstrapPassword);
    await new ConfigurationProvider(app).start();
    const usersAfterOtherAddress = await db.from('users');
    assert.equal(usersAfterOtherAddress.length, 1);
    assert.equal((await db.from('users').where('id', otherId).first())!.password, before.password);
    assert.lengthOf(await db.from('account_admissions').where('user_id', otherId), 0);
    assert.lengthOf(await db.from('account_admissions').whereNotNull('user_id'), 0);

    const secondId = await createIdentity('diana.prince@wayne.example', {
      name: 'Diana Prince',
      password: bootstrapPassword,
      admitted: false,
    });
    const secondBefore = await db.from('users').where('id', secondId).first();
    await new ConfigurationProvider(app).start();
    const usersAfterPopulatedStart = await db.from('users');
    assert.equal(usersAfterPopulatedStart.length, 2);
    assert.equal(
      (await db.from('users').where('id', secondId).first())!.password,
      secondBefore.password
    );
    assert.lengthOf(await db.from('account_admissions').whereNotNull('user_id'), 0);
  });
});
