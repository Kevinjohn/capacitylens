import { test } from '@japa/runner';
import { freshDatabase } from '../../helpers/fresh_database.js';
import db from '@adonisjs/lucid/services/db';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '../../helpers/authenticated_data_fixture.js';
import { resetState } from '#services/state_repository';
import { signUpAndIn } from '../../helpers/identities.js';

const password = 'batman-secret-2026';
const withSession = asDataOwner;

test.group('direct member resource association', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await db.from('account_admissions').delete();
    await db.from('account_invitations').delete();
    await db.from('adonis_sessions').delete();
    await db.from('users').delete();
  });

  test('member directory preserves selected link labels, order, nulls and company scope', async ({
    client,
    assert,
  }) => {
    const owner = await signUpAndIn(client, {
      email: 'bruce.wayne@wayne.example',
      name: 'Bruce Wayne',
      password,
    });
    const ownerCookie = owner.cookie('adonis-session')!.value;
    const ownerId = (owner.body() as { user: { id: string } }).user.id;
    await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', 'a-studio');
    const clark = await signUpAndIn(client, {
      email: 'clark.kent@wayne.example',
      name: 'Clark Kent',
      password,
    });
    const clarkId = (clark.body() as { user: { id: string } }).user.id;
    const diana = await signUpAndIn(client, {
      email: 'diana.prince@wayne.example',
      name: 'Diana Prince',
      password,
    });
    const dianaId = (diana.body() as { user: { id: string } }).user.id;
    const barbara = await signUpAndIn(client, {
      email: 'barbara.gordon@wayne.example',
      name: 'Barbara Gordon',
      password,
    });
    const barbaraId = (barbara.body() as { user: { id: string } }).user.id;
    const now = new Date().toISOString();
    const orderedAt = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
    await db.table('memberships').insert([
      {
        id: 'member-clark',
        account_id: 'a-studio',
        user_id: clarkId,
        role: 'editor',
        status: 'active',
        created_at: orderedAt(1),
        updated_at: now,
      },
      {
        id: 'member-diana',
        account_id: 'a-studio',
        user_id: dianaId,
        role: 'editor',
        status: 'active',
        created_at: orderedAt(2),
        updated_at: now,
      },
      {
        id: 'member-barbara',
        account_id: 'a-studio',
        user_id: barbaraId,
        role: 'editor',
        status: 'active',
        created_at: orderedAt(3),
        updated_at: now,
      },
    ]);
    await db.table('accounts').insert({
      id: 'a-loft',
      name: 'Stark Industries',
      color: '#6366f1',
      created_at: now,
      updated_at: now,
    });
    const person = (
      id: string,
      accountId: string,
      archivedAt: string | null = null,
      deletedAt: string | null = null
    ) => ({
      id,
      account_id: accountId,
      kind: 'person',
      name: id,
      role: 'Designer',
      employment_type: 'permanent',
      engagement: 'studio',
      working_hours_per_day: 8,
      working_days: '[1,2,3,4,5]',
      half_days: '[]',
      color: '#6366f1',
      archived_at: archivedAt,
      deleted_at: deletedAt,
      created_at: now,
      updated_at: now,
    });
    await db
      .table('resources')
      .insert([
        person('r-active', 'a-studio'),
        person('r-archived', 'a-studio', now),
        person('r-deleted', 'a-studio', null, now),
        person('r-stark', 'a-loft'),
      ]);
    await db.table('account_member_resources').insert([
      {
        id: 'link-clark',
        account_id: 'a-studio',
        user_id: clarkId,
        resource_id: 'r-active',
        revision: 'rev-clark',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'link-diana',
        account_id: 'a-studio',
        user_id: dianaId,
        resource_id: 'r-archived',
        revision: 'rev-diana',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'link-barbara',
        account_id: 'a-studio',
        user_id: barbaraId,
        resource_id: 'r-deleted',
        revision: 'rev-barbara',
        created_at: now,
        updated_at: now,
      },
    ]);
    await db.table('account_member_resources').insert({
      id: 'link-stark',
      account_id: 'a-loft',
      user_id: dianaId,
      resource_id: 'r-stark',
      revision: 'rev-stark',
      created_at: now,
      updated_at: now,
    });

    const response = await asDataOwner(
      client.get('/api/accounts/a-studio/members'),
      ownerCookie
    ).send();
    response.assertStatus(200);
    const body = response.body() as {
      members: Array<{ userId: string; resourceLink: null | Record<string, unknown> }>;
      resourceCandidates: Array<{ resourceId: string; label: string }>;
    };
    assert.deepEqual(
      body.members.map((member) => member.userId),
      [ownerId, clarkId, dianaId, barbaraId]
    );
    assert.isNull(body.members[0]!.resourceLink);
    assert.deepEqual(body.members[1]!.resourceLink, {
      resourceId: 'r-active',
      revision: 'rev-clark',
      resourceName: 'r-active',
      resourceStatus: 'active',
    });
    assert.equal(body.members[2]!.resourceLink?.resourceStatus, 'archived');
    assert.equal(body.members[3]!.resourceLink?.resourceStatus, 'archived');
    assert.sameDeepMembers(body.resourceCandidates, [
      { resourceId: 'r-active', label: 'r-active' },
    ]);
    assert.notInclude(JSON.stringify(body), 'r-stark');
  });

  test('direct links enforce company, person, occupancy and current-revision constraints', async ({
    client,
    assert,
  }) => {
    const owner = await signUpAndIn(client, {
      email: 'bruce.wayne@wayne.example',
      name: 'Bruce Wayne',
      password,
    });
    owner.assertStatus(200);
    const ownerCookie = owner.cookie('adonis-session')!.value;
    const ownerId = (owner.body() as { user: { id: string } }).user.id;
    await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', 'a-studio');
    const now = new Date().toISOString();
    await db.table('accounts').insert({
      id: 'a-loft',
      name: 'Stark Industries',
      color: '#6366f1',
      created_at: now,
      updated_at: now,
    });
    const person = (id: string, accountId: string, kind = 'person') => ({
      id,
      account_id: accountId,
      kind,
      name: id,
      role: 'Designer',
      employment_type: 'permanent',
      engagement: 'studio',
      working_hours_per_day: 8,
      working_days: '[1,2,3,4,5]',
      half_days: '[]',
      color: '#6366f1',
      created_at: now,
      updated_at: now,
    });
    await db
      .table('resources')
      .insert([
        person('r-clark', 'a-studio'),
        person('r-barry', 'a-studio'),
        person('r-external', 'a-studio', 'external'),
        person('r-stark', 'a-loft'),
      ]);
    const put = (userId: string, resourceId: string, expectedRevision: string | null) =>
      withSession(
        client
          .put(`/api/accounts/a-studio/members/${userId}/resource-link`)
          .header('sec-fetch-site', 'same-origin'),
        ownerCookie
      )
        .json({ resourceId, expectedRevision })
        .send();
    const outside = await put(ownerId, 'r-stark', null);
    outside.assertStatus(409);
    const wrongKind = await put(ownerId, 'r-external', null);
    wrongKind.assertStatus(409);
    const revisionRowBeforeLink = await db
      .from('company_planning_revisions')
      .where('account_id', 'a-studio')
      .first();
    const revisionBeforeLink = Number(revisionRowBeforeLink?.revision);
    const auditCountBeforeLink = await db
      .from('audit_entries')
      .where({ account_id: 'a-studio', action: 'member-resource.linked', entity_id: ownerId })
      .count('* as total');
    assert.equal(Number(auditCountBeforeLink[0].total), 0);
    const linked = await put(ownerId, 'r-clark', null);
    linked.assertStatus(200);
    const revision = (linked.body() as { revision: string }).revision;
    const revisionRowAfterLink = await db
      .from('company_planning_revisions')
      .where('account_id', 'a-studio')
      .first();
    const revisionAfterLink = Number(revisionRowAfterLink?.revision);
    assert.equal(revisionAfterLink, revisionBeforeLink + 1);
    const auditCountAfterLink = await db
      .from('audit_entries')
      .where({ account_id: 'a-studio', action: 'member-resource.linked', entity_id: ownerId })
      .count('* as total');
    assert.equal(Number(auditCountAfterLink[0].total), 1);
    const repeatLink = () =>
      withSession(
        client
          .put(`/api/accounts/a-studio/members/${ownerId}/resource-link`)
          .header('sec-fetch-site', 'same-origin'),
        ownerCookie
      )
        .headers({
          'x-account-command-id': 'member-link-noop-command-0001',
          'idempotency-key': 'member-link-noop-idempotency-0001',
        })
        .json({ resourceId: 'r-clark', expectedRevision: revision })
        .send();
    const unchanged = await repeatLink();
    unchanged.assertStatus(200);
    assert.deepEqual(unchanged.body(), linked.body());
    const replay = await repeatLink();
    replay.assertStatus(200);
    assert.deepEqual(replay.body(), linked.body());
    const revisionRowAfterNoop = await db
      .from('company_planning_revisions')
      .where('account_id', 'a-studio')
      .first();
    assert.equal(Number(revisionRowAfterNoop?.revision), revisionAfterLink);
    const auditCountAfterNoop = await db
      .from('audit_entries')
      .where({ account_id: 'a-studio', action: 'member-resource.linked', entity_id: ownerId })
      .count('* as total');
    assert.equal(Number(auditCountAfterNoop[0].total), Number(auditCountAfterLink[0].total));
    const stale = await put(ownerId, 'r-barry', null);
    stale.assertStatus(409);
    await db.from('resources').where('id', 'r-clark').update({ archived_at: now });
    const archivedCurrent = await put(ownerId, 'r-barry', revision);
    archivedCurrent.assertStatus(409);
    const cleared = await withSession(
      client
        .delete(`/api/accounts/a-studio/members/${ownerId}/resource-link`)
        .header('sec-fetch-site', 'same-origin'),
      ownerCookie
    )
      .json({ expectedRevision: revision })
      .send();
    cleared.assertStatus(204);
    const second = await put(ownerId, 'r-barry', null);
    second.assertStatus(200);
    const otherId = crypto.randomUUID();
    await db.table('users').insert({
      id: otherId,
      email: 'barry.allen@wayne.example',
      email_verified_at: new Date().toISOString(),
      display_name: 'Barry Allen',
      created_at: now,
      updated_at: now,
    });
    await db.table('memberships').insert({
      id: crypto.randomUUID(),
      account_id: 'a-studio',
      user_id: otherId,
      role: 'viewer',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    const occupied = await put(otherId, 'r-barry', null);
    occupied.assertStatus(409);
    const clear = (userId: string, expectedRevision: string) =>
      withSession(
        client
          .delete(`/api/accounts/a-studio/members/${userId}/resource-link`)
          .header('sec-fetch-site', 'same-origin'),
        ownerCookie
      )
        .json({ expectedRevision })
        .send();
    const ownerCleared = await clear(ownerId, second.body().revision);
    ownerCleared.assertStatus(204);
    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: ownerId })
      .update({ role: 'admin' });
    for (const unavailable of ['inactive', 'restricted']) {
      await db
        .from('memberships')
        .where({ account_id: 'a-studio', user_id: otherId })
        .update({ status: 'active' });
      await db
        .from('account_access_restrictions')
        .where({ account_id: 'a-studio', principal_id: otherId })
        .delete();
      const link = await put(otherId, 'r-barry', null);
      link.assertStatus(200);
      const expected = link.body().revision;
      if (unavailable === 'inactive')
        await db
          .from('memberships')
          .where({ account_id: 'a-studio', user_id: otherId })
          .update({ status: 'inactive' });
      else
        await db.table('account_access_restrictions').insert({
          id: crypto.randomUUID(),
          account_id: 'a-studio',
          principal_id: otherId,
          role: 'viewer',
          created_at: now,
        });
      const refusedSet = await put(otherId, 'r-barry', expected);
      refusedSet.assertStatus(unavailable === 'inactive' ? 409 : 403);
      const clearedUnavailable = await clear(otherId, expected);
      clearedUnavailable.assertStatus(204);
      const clearedMissing = await clear(otherId, expected);
      clearedMissing.assertStatus(409);
    }
  });
});
