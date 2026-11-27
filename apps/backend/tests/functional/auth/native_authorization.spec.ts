import { test } from '@japa/runner';
import { freshDatabase } from '#tests/helpers/fresh_database';
import db from '@adonisjs/lucid/services/db';
import { resetState } from '#tests/helpers/state_fixture';
import { seed } from '@capacitylens/shared/data/seed';
import { expectStatus } from '#tests/helpers/identities';
import { asLoggedInDataOwner } from '#tests/helpers/authenticated_data_fixture';
import User from '#models/user';
import {
  companyId,
  otherCompanyId,
  privateClientName,
  privateProjectName,
  privateTimeOffNote,
  roles,
  input,
  trusted,
  configureAuth,
  createMember,
  setRole,
  stateFor,
  currentUser,
  writeDismissal,
  importSeed,
  anonymiseResource,
  preparePrivateProjection,
} from '#tests/helpers/auth/native_authorization';

test.group('native authorization and role projections', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await db.from('account_admissions').delete();
    await db.from('account_invitations').delete();
    await db.from('adonis_sessions').delete();
    await db.from('memberships').delete();
    await db.from('users').delete();
    await db.from('rate_limits').delete();
    await db.from('company_getting_started_dismissals').delete();
    await resetState(true);
  });

  test('protected reads require a real member and cross-company rows stay concealed', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie, userId } = await createMember(client, 'editor');

    const anonymous = await trusted(
      client.visit('api.company_state.show').qs({ companyId })
    ).send();
    anonymous.assertStatus(401);
    const openHealth = await client.visit('health_checks.live').send();
    openHealth.assertStatus(200);

    await db.from('memberships').where({ user_id: userId }).delete();
    const nonMember = await stateFor(client, cookie);
    nonMember.assertStatus(403);
    const nonMemberProjection = await currentUser(client, cookie);
    nonMemberProjection.assertStatus(200);

    await db.table('memberships').insert({
      scope_id: companyId,
      user_id: userId,
      role: 'editor',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const foreignRead = await stateFor(client, cookie, otherCompanyId);
    foreignRead.assertStatus(403);

    const foreignClient = seed().clients.find((row) => row.companyId === otherCompanyId);
    assert.isDefined(foreignClient);
    const concealed = await asLoggedInDataOwner(
      trusted(client.post(`/api/v1/clients/${foreignClient!.id}/archive`)),
      await User.findOrFail(userId)
    )
      .json({ companyId })
      .send();
    concealed.assertStatus(404);
    assert.notInclude(JSON.stringify(concealed.body()), foreignClient!.name);
    const foreignRow = await db.from('clients').where({ id: foreignClient!.id }).first();
    assert.equal(foreignRow?.company_id, otherCompanyId);
  });

  test('four roles separate read, ordinary write, resource anonymisation, and whole-slice import access', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie, userId } = await createMember(client, 'viewer');
    const user = await User.findOrFail(userId);
    const anonymiseCandidates = seed().resources.filter((row) => row.companyId === companyId);
    assert.isAtLeast(anonymiseCandidates.length, 2);

    for (const role of roles) {
      await setRole(userId, role);
      const read = await stateFor(client, cookie);
      read.assertStatus(200);
      const body = read.body().data as {
        companies: Array<{ id: string }>;
        clients: Array<{ companyId: string }>;
      };
      assert.deepEqual(
        body.companies.map((row) => row.id),
        [companyId]
      );
      assert.isTrue(body.clients.every((row) => row.companyId === companyId));

      const me = await currentUser(client, cookie);
      me.assertStatus(200);

      const currentPlanning = await asLoggedInDataOwner(
        trusted(client.visit('api.planning.show', { companyId })),
        user
      ).send();
      currentPlanning.assertStatus(200);
      const planning = currentPlanning.body().data as { revision: number };
      const settingsRequest = trusted(client.visit('api.planning_mutations.store', { companyId }));
      const setting = await asLoggedInDataOwner(settingsRequest, user)
        .json(
          input(planning.revision, {
            operation: 'settings.update',
            changes: { name: `Gotham planning ${role}` },
          }) as never
        )
        .send();
      assert.equal(setting.status(), role === 'viewer' ? 403 : 200, `${role} ordinary write`);

      const dismissal = await writeDismissal(client, cookie);
      assert.equal(
        dismissal.status(),
        role === 'admin' || role === 'owner' ? 200 : 403,
        `${role} checklist dismissal`
      );
      const dismissalCount = await db
        .from('company_getting_started_dismissals')
        .where('company_id', companyId)
        .count('* as total');
      assert.equal(dismissalCount[0]?.total, role === 'admin' || role === 'owner' ? 1 : 0);
      if (role === 'admin' || role === 'owner') {
        await db.from('company_getting_started_dismissals').delete();
      }

      const target = role === 'owner' ? anonymiseCandidates[1]! : anonymiseCandidates[0]!;
      const anonymised = await anonymiseResource(client, cookie, target.id);
      assert.equal(
        anonymised.status(),
        role === 'admin' || role === 'owner' ? 204 : 403,
        `${role} resource anonymisation`
      );

      const importing = await importSeed(client, cookie);
      assert.equal(importing.status(), 403, `${role} import without password confirmation`);
    }
  });

  test('state projection scopes resources and redacts private names and time-off notes by role', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie, userId } = await createMember(client, 'owner');
    const fixture = await preparePrivateProjection();

    for (const role of roles) {
      await setRole(userId, role);
      const response = await stateFor(client, cookie);
      response.assertStatus(200);
      const serialized = JSON.stringify(response.body().data);
      const body = response.body().data as {
        clients: Array<{ id: string; name: string; codeName?: string | null }>;
        projects: Array<{ id: string; name: string; codeName?: string | null }>;
        resources: Array<{ id: string; companyId: string }>;
        timeOff: Array<{ id: string; note?: string | null }>;
      };
      const projectedClient = body.clients.find((row) => row.id === fixture.clientId);
      const projectedProject = body.projects.find((row) => row.id === fixture.projectId);
      const projectedTimeOff = body.timeOff.find((row) => row.id === fixture.timeOffId);
      assert.isDefined(projectedClient, `${role} client projection`);
      assert.isDefined(projectedProject, `${role} project projection`);
      assert.isDefined(projectedTimeOff, `${role} time-off projection`);
      assert.isTrue(body.resources.every((row) => row.companyId === companyId));
      assert.include(
        body.resources.map((row) => row.id),
        fixture.resourceId
      );

      if (role === 'owner') {
        assert.equal(projectedClient!.name, privateClientName);
        assert.equal(projectedProject!.name, privateProjectName);
        assert.equal(projectedClient!.codeName, 'Nightwing');
        assert.equal(projectedProject!.codeName, 'Aurora');
        assert.equal(projectedTimeOff!.note, privateTimeOffNote);
      } else {
        assert.equal(projectedClient!.name, '"Nightwing"');
        assert.equal(projectedProject!.name, '"Aurora"');
        assert.isNull(projectedClient!.codeName);
        assert.isNull(projectedProject!.codeName);
        assert.notInclude(serialized, privateClientName);
        assert.notInclude(serialized, privateProjectName);
        if (role === 'admin') assert.equal(projectedTimeOff!.note, privateTimeOffNote);
        else {
          assert.isNull(projectedTimeOff!.note);
          assert.notInclude(serialized, privateTimeOffNote);
        }
      }
    }
  });

  test('import needs a password confirmation however recent the sign-in, while reads and writes do not', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie, userId } = await createMember(client, 'owner');
    for (const ageMinutes of [0, 16]) {
      await db
        .from('account_sessions')
        .where('user_id', userId)
        .update({ created_at: new Date(Date.now() - ageMinutes * 60_000).toISOString() });
      const imported = await importSeed(client, cookie);
      imported.assertStatus(403);
      assert.equal((imported.body() as { code?: string }).code, 'E_PASSWORD_CONFIRMATION_REQUIRED');
      await expectStatus(stateFor(client, cookie), 200);
      await expectStatus(writeDismissal(client, cookie), 200);
    }
  });

  test('a current role downgrade takes effect on the next data transaction', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie, userId } = await createMember(client, 'admin');
    const before = await writeDismissal(client, cookie);
    before.assertStatus(200);

    await setRole(userId, 'viewer');
    const denied = await writeDismissal(client, cookie);
    denied.assertStatus(403);
    const stillReadable = await stateFor(client, cookie);
    stillReadable.assertStatus(200);
    assert.deepEqual(
      await db
        .from('company_getting_started_dismissals')
        .where('company_id', companyId)
        .count('* as total'),
      [{ total: 1 }]
    );
  });

  test('an invalid getting-started dismissal is refused and records nothing', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await createMember(client, 'owner');
    for (const body of [{}, { dismissed: false }, { dismissed: 'yes' }]) {
      const refused = await writeDismissal(client, cookie, body);
      refused.assertStatus(422);
      assert.isNotEmpty((refused.body() as { errors?: unknown[] }).errors, JSON.stringify(body));
    }
    assert.deepEqual(
      await db
        .from('company_getting_started_dismissals')
        .where('company_id', companyId)
        .count('* as total'),
      [{ total: 0 }]
    );
  });
});
