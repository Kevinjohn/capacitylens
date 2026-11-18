import { fixtureSession, signIn, signUpAndIn } from '../helpers/identities.js';
import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
  resetAuthenticatedData,
} from '../helpers/authenticated_data_fixture.js';
import { freshDatabase } from '../helpers/fresh_database.js';
import type { ApiClient } from '@japa/api-client';
import { randomUUID } from 'node:crypto';
import { withTransaction } from '#services/with_transaction';
import { getPlanningRevision } from '#services/planning_revision';
import { encodeRow } from '#services/state_repository';
import { readState } from '#tests/helpers/state_fixture';
import { seed } from '@capacitylens/shared/data/seed';

const companyId = 'a-studio';
const password = 'fixture-password-2026';

async function proof(client: ApiClient, cookie: string) {
  const issued = await asDataOwner(client.post('/api/auth/password-confirmation'), cookie)
    .json({ action: 'anonymise', companyId, intent: {}, password: 'fixture-password-2026' })
    .send();
  issued.assertStatus(200);
  return (issued.body() as { confirmationId: string }).confirmationId;
}

async function deleteAllocation(client: ApiClient, cookie: string, resourceId: string) {
  const allocation = await db
    .from('allocations')
    .where({ company_id: companyId, resource_id: resourceId })
    .first();
  if (!allocation) throw new Error(`Missing allocation for resource ${resourceId}`);
  const baseRevision = await withTransaction((trx) => getPlanningRevision(trx, companyId));
  const mutationId = randomUUID();
  const removed = await asDataOwner(
    client.post(`/api/companies/${companyId}/allocations/${allocation.id}/delete`),
    cookie
  )
    .json({
      mutationId,
      baseRevision,
      // Naming a history makes the delete undoable, so the company holds a history to clear.
      historyId: randomUUID(),
      intent: { operation: 'allocation.delete', id: allocation.id },
    })
    .send();
  removed.assertStatus(200);
  const groupId = (removed.body() as { restoration: { replacementGroupId: string } }).restoration
    .replacementGroupId;
  return { allocation, groupId, mutationId };
}

async function restoreAllocation(client: ApiClient, cookie: string, groupId: string) {
  const baseRevision = await withTransaction((trx) => getPlanningRevision(trx, companyId));
  return asDataOwner(client.post(`/api/companies/${companyId}/planning/restore-group`), cookie)
    .json({
      mutationId: randomUUID(),
      baseRevision,
      intent: { operation: 'planning.restoreGroup', restorationGroupId: groupId },
    })
    .send();
}

async function seedOtherCompanyRestoration(actorId: string) {
  const groupId = randomUUID();
  const mutationId = randomUUID();
  const sessionId = await fixtureSession(actorId);
  const createdAt = new Date().toISOString();
  const revision = (await withTransaction((trx) => getPlanningRevision(trx, 'a-loft'))) + 1;
  await db.table('deleted_groups').insert({
    group_id: groupId,
    company_id: 'a-loft',
    actor_id: actorId,
    session_id: sessionId,
    mutation_id: mutationId,
    created_at: createdAt,
    consumed_at: null,
  });
  await db.table('deleted_rows').insert({
    group_id: groupId,
    entity: 'allocations',
    row_id: 'fixture-other-company-allocation',
    payload_json: JSON.stringify({ kind: 'row' }),
  });
  await db.table('planning_mutations').insert({
    company_id: 'a-loft',
    mutation_id: mutationId,
    actor_id: actorId,
    revision,
    restoration_group_id: groupId,
    origin_session_id: sessionId,
  });
  await db.from('company_planning_revisions').where('company_id', 'a-loft').update({ revision });
  await db.table('audit_entries').insert({
    id: randomUUID(),
    company_id: 'a-loft',
    actor_id: actorId,
    action: 'allocation.delete',
    entity: 'planning',
    entity_id: mutationId,
    details: JSON.stringify({ changedFields: ['allocations'] }),
    created_at: createdAt,
    updated_at: createdAt,
  });
  return { groupId, mutationId, revision };
}

test.group('company anonymisation', (group) => {
  group.setup(() => freshDatabase());

  test('retired generic lifecycle routes are absent', async ({ client }) => {
    const { cookie } = await resetAuthenticatedData(client, true);
    for (const path of [
      '/api/resources/r-tyler/delete',
      '/api/resources/r-tyler/purge',
      '/api/resources/r-tyler/archive',
    ]) {
      const response = await asDataOwner(client.post(path), cookie).json({ companyId }).send();
      response.assertStatus(404);
    }
  });

  test('resource anonymisation scrubs only its person and notes with one audit and revision', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client, true);
    const otherAccountId = await createFixtureCompanyForOwner(
      userId,
      'Stark Industries',
      'a-anonymise-other'
    );
    const person = seed().resources.find((row) => row.kind === 'person')!;
    await db.table('resources').insert(
      encodeRow('resources', {
        ...person,
        id: 'r-anonymise-other',
        companyId: otherAccountId,
        disciplineId: null,
      })
    );
    const otherBefore = await readState(otherAccountId, true);
    const resources = await db.from('resources').where('company_id', companyId).limit(2);
    const target = resources[0]!;
    const other = resources[1]!;
    await db
      .from('resources')
      .where('id', target.id)
      .update({ avatar_url: 'https://example.invalid/avatar.png' });
    const allocation = await db
      .from('allocations')
      .where({ company_id: companyId, resource_id: target.id })
      .first();
    assert.isDefined(allocation);
    await db.from('allocations').where({ id: allocation!.id }).update({ note: 'Private note' });
    const timeOff = await db
      .from('time_off')
      .where({ company_id: companyId, resource_id: target.id })
      .first();
    assert.isDefined(timeOff);
    await db.from('time_off').where({ id: timeOff!.id }).update({ note: 'Private time off note' });
    const deleted = await deleteAllocation(client, cookie, other.id);
    const savedRows = await db.from('deleted_rows').where('group_id', deleted.groupId);
    assert.isAbove(savedRows.length, 0);
    const before = await withTransaction((trx) => getPlanningRevision(trx, companyId));
    const changed = await asDataOwner(
      client.post(`/api/companies/${companyId}/resources/${target.id}/anonymise`),
      cookie
    )
      .json({})
      .send();
    changed.assertStatus(204);
    assert.deepEqual(await readState(otherAccountId, true), otherBefore);
    const scrubbed = await db.from('resources').where('id', target.id).first();
    assert.equal(
      scrubbed.name,
      `Removed person #${target.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`
    );
    assert.equal(scrubbed.role, 'Removed resource');
    assert.isNull(scrubbed.avatar_url);
    const untouched = await db.from('resources').where('id', other.id).first();
    assert.equal(untouched.name, other.name);
    assert.lengthOf(
      await db
        .from('allocations')
        .where({ company_id: companyId, resource_id: target.id })
        .whereNotNull('note'),
      0
    );
    assert.lengthOf(
      await db
        .from('time_off')
        .where({ company_id: companyId, resource_id: target.id })
        .whereNotNull('note'),
      0
    );
    assert.isNull(await db.from('deleted_groups').where('group_id', deleted.groupId).first());
    assert.lengthOf(await db.from('planning_histories').where('company_id', companyId), 0);
    assert.lengthOf(await db.from('deleted_rows').where('group_id', deleted.groupId), 0);
    assert.isNull(await db.from('allocations').where('id', deleted.allocation.id).first());
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, action: 'anonymise' }),
      1
    );
    assert.equal(await withTransaction((trx) => getPlanningRevision(trx, companyId)), before + 1);
  });

  test('an Editor cannot anonymise an individual resource', async ({ client, assert }) => {
    const { cookie, userId } = await resetAuthenticatedData(client, true);
    const target = await db.from('resources').where('company_id', companyId).first();
    await db
      .from('memberships')
      .where({ scope_id: companyId, user_id: userId })
      .update({ role: 'editor' });
    const refused = await asDataOwner(
      client.post(`/api/companies/${companyId}/resources/${target.id}/anonymise`),
      cookie
    )
      .json({})
      .send();
    refused.assertStatus(403);
    const unchanged = await db.from('resources').where('id', target.id).first();
    assert.equal(unchanged.name, target.name);
  });

  test('requires proof and scrubs all resources in one audited revision while retaining company identity', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client, true);
    const foreignDelete = await seedOtherCompanyRestoration(userId);
    const foreignProductBefore = await readState('a-loft', true);
    const resource = await db.from('resources').where('company_id', companyId).first();
    await db.table('account_member_resources').insert({
      id: 'link-bruce-person',
      company_id: companyId,
      user_id: userId,
      resource_id: resource.id,
      revision: 'test',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await db
      .from('resources')
      .where('id', resource.id)
      .update({ avatar_url: 'https://example.invalid/person.png' });
    const allocation = await db
      .from('allocations')
      .where({ company_id: companyId, resource_id: resource.id })
      .first();
    assert.isDefined(allocation);
    await db
      .from('allocations')
      .where({ id: allocation!.id })
      .update({ note: 'Sensitive allocation note' });
    const timeOff = await db
      .from('time_off')
      .where({ company_id: companyId, resource_id: resource.id })
      .first();
    assert.isDefined(timeOff);
    await db
      .from('time_off')
      .where({ id: timeOff!.id })
      .update({ note: 'Sensitive time off note' });
    const selectedDelete = await deleteAllocation(client, cookie, resource.id);
    const membershipBefore = await db.from('memberships').where('scope_id', companyId).select('*');
    const memberLinksBefore = await db
      .from('account_member_resources')
      .where('company_id', companyId)
      .select('*');
    const planningCommitmentsBefore = await db
      .from('planning_mutations')
      .where('company_id', companyId)
      .select('*');
    const receiptStamp = new Date().toISOString();
    await db.table('request_receipts').insert({
      id: 'retained-member-command',
      scope_id: companyId,
      command_id: 'retained-member-command-0001',
      operation: JSON.stringify(['change-member-role', userId]),
      request_key: 'retained-member-key-0001',
      payload_hash: 'a'.repeat(64),
      state: 'completed',
      result: JSON.stringify({ userId, role: 'owner' }),
      created_at: receiptStamp,
      updated_at: receiptStamp,
    });
    const commandCommitmentsBefore = await db
      .from('request_receipts')
      .where('scope_id', companyId)
      .select('*');
    assert.lengthOf(commandCommitmentsBefore, 1);
    const auditBefore = await db.from('audit_entries').where('company_id', companyId).select('*');
    const foreignGroupBefore = await db
      .from('deleted_groups')
      .where('group_id', foreignDelete.groupId)
      .first();
    const foreignPayloadBefore = await db
      .from('deleted_rows')
      .where('group_id', foreignDelete.groupId)
      .select('*');
    const foreignCommitmentsBefore = await db
      .from('planning_mutations')
      .where('company_id', 'a-loft')
      .select('*');
    const foreignRevisionBefore = await withTransaction((trx) =>
      getPlanningRevision(trx, 'a-loft')
    );
    const foreignAuditBefore = await db
      .from('audit_entries')
      .where('company_id', 'a-loft')
      .select('*');
    const accountBefore = await db.from('accounts').where('id', companyId).first();
    const before = await withTransaction((trx) => getPlanningRevision(trx, companyId));
    const missing = await asDataOwner(client.post(`/api/companies/${companyId}/anonymise`), cookie)
      .json({ confirmationId: '' })
      .send();
    missing.assertStatus(403);
    assert.equal(await withTransaction((trx) => getPlanningRevision(trx, companyId)), before);
    const confirmationId = await proof(client, cookie);
    const applied = await asDataOwner(client.post(`/api/companies/${companyId}/anonymise`), cookie)
      .json({ confirmationId })
      .send();
    applied.assertStatus(204);
    const resources = await db.from('resources').where('company_id', companyId);
    assert.isAbove(resources.length, 0);
    for (const savedResource of resources) {
      assert.equal(
        savedResource.name,
        `Removed person #${savedResource.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`
      );
      assert.equal(savedResource.role, 'Removed resource');
      assert.isNull(savedResource.avatar_url);
    }
    assert.lengthOf(await db.from('deleted_groups').where('company_id', companyId), 0);
    assert.lengthOf(await db.from('planning_histories').where('company_id', companyId), 0);
    assert.lengthOf(await db.from('deleted_rows').where('group_id', selectedDelete.groupId), 0);
    assert.isNull(await db.from('allocations').where('id', selectedDelete.allocation.id).first());
    assert.isDefined(
      await db
        .from('planning_mutations')
        .where({ company_id: companyId, mutation_id: selectedDelete.mutationId })
        .first()
    );
    assert.isDefined(
      await db.from('deleted_groups').where('group_id', foreignDelete.groupId).first()
    );
    assert.deepEqual(
      await db.from('deleted_groups').where('group_id', foreignDelete.groupId).first(),
      foreignGroupBefore
    );
    assert.deepEqual(
      await db.from('deleted_rows').where('group_id', foreignDelete.groupId).select('*'),
      foreignPayloadBefore
    );
    assert.deepEqual(
      await db.from('planning_mutations').where('company_id', 'a-loft').select('*'),
      foreignCommitmentsBefore
    );
    assert.equal(
      await withTransaction((trx) => getPlanningRevision(trx, 'a-loft')),
      foreignRevisionBefore
    );
    assert.deepEqual(
      await db.from('audit_entries').where('company_id', 'a-loft').select('*'),
      foreignAuditBefore
    );
    assert.deepEqual(await readState('a-loft', true), foreignProductBefore);
    assert.lengthOf(
      await db
        .from('allocations')
        .where({ company_id: companyId, resource_id: resource.id })
        .whereNotNull('note'),
      0
    );
    assert.lengthOf(
      await db
        .from('time_off')
        .where({ company_id: companyId, resource_id: resource.id })
        .whereNotNull('note'),
      0
    );
    assert.deepEqual(await db.from('accounts').where('id', companyId).first(), accountBefore);
    const memberships = await db.from('memberships').where('scope_id', companyId);
    assert.isAbove(memberships.length, 0);
    assert.deepEqual(memberships, membershipBefore);
    assert.equal(memberships.find((membership) => membership.user_id === userId)?.role, 'owner');
    assert.deepEqual(
      await db.from('account_member_resources').where('company_id', companyId).select('*'),
      memberLinksBefore
    );
    assert.deepEqual(
      await db.from('planning_mutations').where('company_id', companyId).select('*'),
      planningCommitmentsBefore
    );
    assert.deepEqual(
      await db.from('request_receipts').where('scope_id', companyId).select('*'),
      commandCommitmentsBefore
    );
    const auditAfter = await db.from('audit_entries').where('company_id', companyId).select('*');
    assert.lengthOf(auditAfter, auditBefore.length + 1);
    assert.deepEqual(auditAfter.slice(0, auditBefore.length), auditBefore);
    assert.equal(auditAfter.at(-1)?.action, 'anonymise');
    assert.equal(auditAfter.at(-1)?.entity_id, companyId);
    assert.equal(await withTransaction((trx) => getPlanningRevision(trx, companyId)), before + 1);
  });

  test('a failed audit write restores saved rows, leaves proof usable and permits restoration', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client, true);
    const resource = await db.from('resources').where('company_id', companyId).first();
    const allocation = await db
      .from('allocations')
      .where({ company_id: companyId, resource_id: resource.id })
      .first();
    assert.isDefined(allocation);
    await db.from('allocations').where({ id: allocation!.id }).update({ note: 'Private note' });
    const deleted = await deleteAllocation(client, cookie, resource.id);
    const groupId = deleted.groupId;
    const groupBefore = await db.from('deleted_groups').where('group_id', groupId).first();
    const payloadBefore = await db.from('deleted_rows').where('group_id', groupId).select('*');
    const commitmentBefore = await db
      .from('planning_mutations')
      .where({ company_id: companyId, mutation_id: deleted.mutationId })
      .first();
    assert.isDefined(groupBefore);
    assert.isAbove(payloadBefore.length, 0);
    assert.isDefined(commitmentBefore);
    const before = await withTransaction((trx) => getPlanningRevision(trx, companyId));
    const confirmationId = await proof(client, cookie);
    await db.rawQuery(`CREATE TRIGGER fail_anonymise_audit BEFORE INSERT ON audit_entries
      WHEN NEW.action = 'anonymise' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
    try {
      const failed = await asDataOwner(client.post(`/api/companies/${companyId}/anonymise`), cookie)
        .json({ confirmationId })
        .send();
      failed.assertStatus(500);
    } finally {
      await db.rawQuery('DROP TRIGGER fail_anonymise_audit');
    }
    const restoredResource = await db.from('resources').where('id', resource.id).first();
    assert.equal(restoredResource.name, resource.name);
    assert.deepEqual(
      await db.from('deleted_groups').where('group_id', groupId).first(),
      groupBefore
    );
    assert.deepEqual(
      await db.from('deleted_rows').where('group_id', groupId).select('*'),
      payloadBefore
    );
    assert.deepEqual(
      await db
        .from('planning_mutations')
        .where({ company_id: companyId, mutation_id: deleted.mutationId })
        .first(),
      commitmentBefore
    );
    assert.lengthOf(
      await db
        .from('password_confirmations')
        .where({ id: confirmationId })
        .whereNull('consumed_at'),
      1
    );
    assert.equal(await withTransaction((trx) => getPlanningRevision(trx, companyId)), before);
    const restored = await restoreAllocation(client, cookie, groupId);
    restored.assertStatus(200);
    const restoredAllocation = await db.from('allocations').where('id', allocation!.id).first();
    assert.equal(restoredAllocation?.note, 'Private note');
    const consumedGroup = await db.from('deleted_groups').where('group_id', groupId).first();
    assert.isDefined(consumedGroup?.consumed_at);
    assert.deepEqual(
      await db.from('deleted_rows').where('group_id', groupId).select('*'),
      payloadBefore
    );
    const applied = await asDataOwner(client.post(`/api/companies/${companyId}/anonymise`), cookie)
      .json({ confirmationId })
      .send();
    applied.assertStatus(204);
  });

  test('wrong-company and spent proofs do not mutate another company', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client, true);
    const before = await db.from('resources').where('company_id', 'a-loft').first();
    const confirmationId = await proof(client, cookie);
    const mismatch = await asDataOwner(client.post('/api/companies/a-loft/anonymise'), cookie)
      .json({ confirmationId })
      .send();
    mismatch.assertStatus(403);
    const unchangedBefore = await db.from('resources').where('id', before.id).first();
    assert.equal(unchangedBefore.name, before.name);
    const first = await asDataOwner(client.post(`/api/companies/${companyId}/anonymise`), cookie)
      .json({ confirmationId })
      .send();
    first.assertStatus(204);
    const replay = await asDataOwner(client.post(`/api/companies/${companyId}/anonymise`), cookie)
      .json({ confirmationId })
      .send();
    replay.assertStatus(403);
    const unchangedAfter = await db.from('resources').where('id', before.id).first();
    assert.equal(unchangedAfter.name, before.name);
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, action: 'anonymise' }),
      1
    );
  });

  test('an Editor cannot anonymise the company with a previously issued Owner proof', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client, true);
    const confirmationId = await proof(client, cookie);
    const resource = await db.from('resources').where('company_id', companyId).first();
    await db
      .from('memberships')
      .where({ scope_id: companyId, user_id: userId })
      .update({ role: 'editor' });
    const denied = await asDataOwner(client.post(`/api/companies/${companyId}/anonymise`), cookie)
      .json({ confirmationId })
      .send();
    denied.assertStatus(403);
    const unchanged = await db.from('resources').where('id', resource.id).first();
    assert.equal(unchanged.name, resource.name);
    assert.lengthOf(
      await db
        .from('password_confirmations')
        .where({ id: confirmationId })
        .whereNull('consumed_at'),
      1
    );
  });

  test('a scrubbed deleted allocation refuses restoration with 409 and removes its saved note', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client, true);
    const allocation = await db.from('allocations').where('company_id', companyId).first();
    await db.from('allocations').where('id', allocation.id).update({ note: 'Private note' });
    const removed = await asDataOwner(
      client.post(`/api/companies/${companyId}/allocations/${allocation.id}/delete`),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: 0,
        intent: { operation: 'allocation.delete', id: allocation.id },
      })
      .send();
    removed.assertStatus(200);
    const groupId = (removed.body() as { restoration: { replacementGroupId: string } }).restoration
      .replacementGroupId;
    const confirmationId = await proof(client, cookie);
    const scrubbed = await asDataOwner(client.post(`/api/companies/${companyId}/anonymise`), cookie)
      .json({ confirmationId })
      .send();
    scrubbed.assertStatus(204);
    assert.lengthOf(await db.from('deleted_groups').where('group_id', groupId), 0);
    assert.lengthOf(await db.from('deleted_rows').where('group_id', groupId), 0);
    const commitment = await db
      .from('planning_mutations')
      .where({ company_id: companyId, restoration_group_id: groupId })
      .first();
    assert.isNumber(commitment.origin_session_id);
    const revision = await withTransaction((trx) => getPlanningRevision(trx, companyId));
    const restored = await asDataOwner(
      client.post(`/api/companies/${companyId}/planning/restore-group`),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: revision,
        intent: { operation: 'planning.restoreGroup', restorationGroupId: groupId },
      })
      .send();
    restored.assertStatus(409);
    assert.lengthOf(await db.from('allocations').where('id', allocation.id), 0);
    const unknown = await asDataOwner(
      client.post(`/api/companies/${companyId}/planning/restore-group`),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: revision,
        intent: { operation: 'planning.restoreGroup', restorationGroupId: randomUUID() },
      })
      .send();
    unknown.assertStatus(403);
    const { cookie: otherSession } = await signIn(
      client,
      'bruce.wayne@wayne.example',
      'fixture-password-2026'
    );
    const foreignSession = await asDataOwner(
      client.post(`/api/companies/${companyId}/planning/restore-group`),
      otherSession
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: revision,
        intent: { operation: 'planning.restoreGroup', restorationGroupId: groupId },
      })
      .send();
    foreignSession.assertStatus(403);

    const wrongCompany = await asDataOwner(
      client.post('/api/companies/a-loft/planning/restore-group'),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: await withTransaction((trx) => getPlanningRevision(trx, 'a-loft')),
        intent: { operation: 'planning.restoreGroup', restorationGroupId: groupId },
      })
      .send();
    wrongCompany.assertStatus(403);
    assert.equal(wrongCompany.body().code, 'AUTHORIZATION_DENIED');

    const otherActorSignup = await signUpAndIn(client, {
      email: 'diana.prince@wayne.example',
      password,
      name: 'Diana Prince',
    });
    otherActorSignup.assertStatus(200);
    const otherActorCookie = otherActorSignup.cookie('adonis-session')?.value;
    assert.isString(otherActorCookie);
    const otherActorId = String((otherActorSignup.body() as { user: { id: string } }).user.id);
    const now = new Date().toISOString();
    await db.table('memberships').insert({
      scope_id: companyId,
      user_id: otherActorId,
      role: 'owner',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    const otherActor = await asDataOwner(
      client.post(`/api/companies/${companyId}/planning/restore-group`),
      otherActorCookie!
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: await withTransaction((trx) => getPlanningRevision(trx, companyId)),
        intent: { operation: 'planning.restoreGroup', restorationGroupId: groupId },
      })
      .send();
    otherActor.assertStatus(403);
    assert.equal(otherActor.body().code, 'AUTHORIZATION_DENIED');
  });
});
