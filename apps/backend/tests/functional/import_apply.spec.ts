import { test } from '@japa/runner';
import { randomUUID } from 'node:crypto';
import db from '@adonisjs/lucid/services/db';
import { buildCompanyExport, type CompanyExport } from '@capacitylens/shared/data/companyExport';
import { readState } from '#tests/helpers/state_fixture';
import hash from '@adonisjs/core/services/hash';
import { seed } from '@capacitylens/shared/data/seed';
import { SCOPED_KEYS } from '@capacitylens/shared/types/entities';
import {
  asDataOwner,
  asLoggedInDataOwner,
  createFixtureCompanyForOwner,
  resetAuthenticatedData,
} from '#tests/helpers/authenticated_data_fixture';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { signIn } from '#tests/helpers/identities';
import User from '#models/user';
import {
  apply,
  deleteForRestoration,
  document,
  proof,
  revision,
} from '#tests/helpers/data/import_apply';

const companyId = 'a-studio';
const password = 'fixture-password-2026';

test.group('beta import apply', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await db.from('account_member_resources').delete();
    await db.from('password_confirmations').delete();
  });

  test('restores a full source export into a fresh company and retains destination access', async ({
    client,
    assert,
  }) => {
    const full = buildCompanyExport(seed(), { companyId: 'a-loft', completeness: 'full' });
    const original = structuredClone(full);
    const { cookie, userId } = await resetAuthenticatedData(client, false);
    await createFixtureCompanyForOwner(userId, 'Wayne Enterprises', companyId);
    const memberships = await db.from('memberships').select('*');
    const identities = await db.from('users').select('*');
    const admissions = await db.from('account_admissions').select('*');
    const preview = await asDataOwner(client.visit('api.import_previews.store'), cookie)
      .json({ companyId, document: full })
      .send();
    preview.assertStatus(200);
    assert.deepInclude(preview.body().data, {
      companyName: full.data.companies[0]!.name,
      counts: Object.fromEntries(SCOPED_KEYS.map((key) => [key, full.data[key].length])),
    });
    const baseRevision = (preview.body().data as { baseRevision: number }).baseRevision;
    const confirmationId = await proof(client, cookie, {
      baseRevision,
      document: full,
    });
    const result = await apply(client, cookie, full, baseRevision, confirmationId);
    result.assertStatus(200);
    assert.deepInclude(result.body().data, { changed: true, revision: baseRevision + 1 });
    const expected = structuredClone(full.data);
    expected.companies[0]!.id = companyId;
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
      for (const row of expected[key]) row.companyId = companyId;
    }
    assert.deepEqual(await readState(companyId, true), expected);
    assert.deepEqual(await db.from('memberships').select('*'), memberships);
    assert.deepEqual(await db.from('users').select('*'), identities);
    assert.deepEqual(await db.from('account_admissions').select('*'), admissions);
    assert.deepEqual(full, original);
    const repeatPreview = await asDataOwner(client.visit('api.import_previews.store'), cookie)
      .json({ companyId, document: full })
      .send();
    repeatPreview.assertStatus(200);
    assert.isFalse((repeatPreview.body().data as { changed: boolean }).changed);
  });

  test('preview replies with the reason a document is refused', async ({ client, assert }) => {
    const { userId } = await resetAuthenticatedData(client);
    const user = await User.findOrFail(userId);
    const full = await document();
    const redacted = buildCompanyExport(await readState(companyId, true), {
      companyId,
      completeness: 'redacted',
    });
    const refusals: [unknown, string][] = [
      [{ hello: 'world' }, 'format: is not a beta-native CapacityLens export'],
      [{ ...full, schemaVersion: 3 }, 'schemaVersion: is unsupported'],
      [redacted, 'completeness: only full exports can be imported'],
    ];
    for (const [value, error] of refusals) {
      const response = await asLoggedInDataOwner(client.visit('api.import_previews.store'), user)
        .json({ companyId, document: value })
        .send();
      response.assertStatus(400);
      assert.deepEqual(response.body(), { error });
    }
  });

  test('preview and apply both refuse a timestamp that is not in the stored form', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client);
    const before = await readState(companyId, true);
    const baseRevision = await revision();
    const changed = await document();
    const row = changed.data.clients[0];
    if (!row) throw new Error('The import fixture has no client.');
    // The same instant the models store as `2026-11-24T10:11:12.000Z`, spelt without milliseconds.
    row.updatedAt = '2026-11-24T10:11:12Z';

    const preview = await asLoggedInDataOwner(
      client.visit('api.import_previews.store'),
      await User.findOrFail(userId)
    )
      .json({ companyId, document: changed })
      .send();
    preview.assertStatus(400);
    assert.deepEqual(preview.body(), {
      error: 'data.clients[0].updatedAt: updatedAt must be a UTC timestamp with milliseconds.',
    });

    const applied = await apply(client, cookie, changed, baseRevision);
    applied.assertStatus(400);
    assert.deepEqual(applied.body(), { error: 'Invalid beta import request.' });
    assert.deepEqual(await readState(companyId, true), before);
    assert.equal(await revision(), baseRevision);
  });

  test('refuses a document whose scheduling IDs belong to another company on this server', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client, true);
    const foreign = buildCompanyExport(seed(), { companyId: 'a-loft', completeness: 'full' });
    const before = await readState(companyId, true);
    const otherBefore = await readState('a-loft', true);
    const baseRevision = await revision();
    const preview = await asDataOwner(client.visit('api.import_previews.store'), cookie)
      .json({ companyId, document: foreign })
      .send();
    preview.assertStatus(409);
    assert.deepInclude(preview.body(), { code: 'E_IMPORT_ID_COLLISION' });
    const confirmationId = await proof(client, cookie, {
      baseRevision,
      document: foreign,
    });
    const result = await apply(client, cookie, foreign, baseRevision, confirmationId);
    result.assertStatus(409);
    assert.deepInclude(result.body(), { code: 'E_IMPORT_ID_COLLISION' });
    assert.deepEqual(await readState(companyId, true), before);
    assert.deepEqual(await readState('a-loft', true), otherBefore);
    assert.equal(await revision(), baseRevision);
  });

  test('requires an exact password confirmation even immediately after owner sign-in', async ({
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
    assert.deepInclude(unchanged.body().data, { changed: false, revision: baseRevision });
    const again = await apply(client, cookie, full, baseRevision, validProof);
    again.assertStatus(403);
    assert.equal(await revision(), baseRevision);
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, action: 'import' }),
      0
    );
  });

  test('previews and applies changed data with stable IDs, links, one revision and one audit', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client);
    const full = await document();
    full.data.companies[0]!.name += ' confirmed';
    const before = await readState(companyId, true);
    const linkedPerson = before.resources.find((row) => row.kind === 'person')!;
    await db.table('account_member_resources').insert({
      id: 'link-bruce-person',
      company_id: companyId,
      user_id: userId,
      resource_id: linkedPerson.id,
      revision: 'test',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const preview = await asDataOwner(client.visit('api.import_previews.store'), cookie)
      .json({ companyId, document: full })
      .send();
    preview.assertStatus(200);
    assert.equal((preview.body().data as { changed: boolean }).changed, true);
    const baseRevision = (preview.body().data as { baseRevision: number }).baseRevision;
    const confirmationId = await proof(client, cookie, {
      baseRevision,
      document: full,
    });
    const result = await apply(client, cookie, full, baseRevision, confirmationId);
    result.assertStatus(200);
    assert.deepInclude(result.body().data, { changed: true, revision: baseRevision + 1 });
    const after = await readState(companyId, true);
    assert.deepEqual(after, full.data);
    assert.equal(after.resources.find((row) => row.id === linkedPerson.id)?.id, linkedPerson.id);
    const memberResource = await db
      .from('account_member_resources')
      .where('company_id', companyId)
      .first();
    assert.equal(memberResource?.resource_id, linkedPerson.id);
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, action: 'import' }),
      1
    );
    assert.equal(await revision(), baseRevision + 1);
  });

  test('invalidates only this company restoration while preserving other company and access records', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client);
    const selected = await document();
    selected.data.companies[0]!.name += ' restored';
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
    const foreignBefore = await readState('a-loft', true);
    const preservedTables = [
      'memberships',
      'account_invitations',
      'account_admissions',
      'planning_mutations',
    ] as const;
    const before = await Promise.all(preservedTables.map((table) => db.from(table).select('*')));
    const baseRevision = await revision();
    const confirmationId = await proof(client, cookie, {
      baseRevision,
      document: selected,
    });
    const result = await apply(client, cookie, selected, baseRevision, confirmationId);
    result.assertStatus(200);
    assert.deepInclude(result.body().data, { changed: true, revision: baseRevision + 1 });
    assert.isNull(
      await db.from('deleted_groups').where('group_id', selectedDelete.groupId).first()
    );
    assert.lengthOf(await db.from('deleted_rows').where('group_id', selectedDelete.groupId), 0);
    assert.lengthOf(await db.from('planning_histories').where('company_id', companyId), 0);
    assert.lengthOf(await db.from('planning_histories').where('company_id', 'a-loft'), 1);
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
          company_id: companyId,
          mutation_id: selectedDelete.mutationId,
          actor_id: userId,
        })
        .first()
    );
    const restore = await asDataOwner(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: baseRevision + 1,
        intent: { operation: 'planning.restoreGroup', restorationGroupId: selectedDelete.groupId },
      })
      .send();
    restore.assertStatus(409);
    const selectedAfter = await readState(companyId, true);
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
    const confirmationId = await proof(client, cookie, {
      baseRevision,
      document: full,
    });
    const other = structuredClone(full);
    other.data.companies[0]!.name += ' changed';
    const wrongDocument = await apply(client, cookie, other, baseRevision, confirmationId);
    wrongDocument.assertStatus(403);
    const wrongRevision = await apply(client, cookie, full, baseRevision + 1, confirmationId);
    wrongRevision.assertStatus(403);
    const wrongAction = await proof(client, cookie, {}, 'anonymise');
    const wrongProof = await apply(client, cookie, full, baseRevision, wrongAction);
    wrongProof.assertStatus(403);
    const wrongCompany = await asDataOwner(client.visit('api.imports.store'), cookie)
      .json({
        companyId: 'a-loft',
        document: full,
        baseRevision,
        confirmationId,
      })
      .send();
    wrongCompany.assertStatus(403);
    assert.deepEqual(await readState(companyId, true), full.data);
    const valid = await apply(client, cookie, full, baseRevision, confirmationId);
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
    const preview = await asDataOwner(client.visit('api.import_previews.store'), cookie)
      .json({ companyId, document: full })
      .send();
    preview.assertStatus(200);
    const baseRevision = (preview.body().data as { baseRevision: number }).baseRevision;
    const confirmationId = await proof(client, cookie, {
      baseRevision,
      document: full,
    });
    const result = await apply(client, cookie, full, baseRevision, confirmationId);
    result.assertStatus(200);
    const after = await readState(companyId, true);
    assert.equal(after.disciplines.length, full.data.disciplines.length);
  });

  test('stale revision, redaction and dangling member links leave data unchanged', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client);
    const full = await document();
    const before = await readState(companyId, true);
    const baseRevision = await revision();
    const staleProof = await proof(client, cookie, { baseRevision, document: full });
    await db.transaction((trx) =>
      trx
        .table('company_planning_revisions')
        .insert({ company_id: companyId, revision: baseRevision + 1 })
    );
    const stale = await apply(client, cookie, full, baseRevision, staleProof);
    stale.assertStatus(409);
    const staleProofRow = await db.from('password_confirmations').where('id', staleProof).first();
    assert.isNull(staleProofRow?.consumed_at);
    const redacted = buildCompanyExport(before, { companyId, completeness: 'redacted' });
    const redactedProof = await proof(client, cookie, {
      baseRevision: baseRevision + 1,
      document: redacted,
    });
    const redactedResponse = await apply(client, cookie, redacted, baseRevision + 1, redactedProof);
    redactedResponse.assertStatus(400);
    await db.table('account_member_resources').insert({
      id: 'link-person-dangling',
      company_id: companyId,
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
    assert.deepEqual(await readState(companyId, true), before);
  });

  test('strips a prototype key from a JSON transfer row without mutating server state', async ({
    client,
    assert,
  }) => {
    const { userId } = await resetAuthenticatedData(client);
    const full = await document();
    const before = await readState(companyId, true);
    const revisionBefore = await revision();
    const auditsBefore = await db.from('audit_entries').where('company_id', companyId);
    const mutationsBefore = await db.from('planning_mutations').where('company_id', companyId);
    const firstClient = full.data.clients[0];
    if (!firstClient) throw new Error('The transfer fixture has no client.');

    // Build the hostile member with JSON text so `__proto__` is an own input key, not an
    // object-literal prototype setter.
    const serializedClient = JSON.stringify(firstClient);
    const clientWithPrototypeKey = JSON.parse(
      `${serializedClient.slice(0, -1)},"__proto__":{"polluted":true}}`
    );
    const documentWithPrototypeKey = JSON.parse(JSON.stringify(full)) as CompanyExport;
    documentWithPrototypeKey.data.clients[0] = clientWithPrototypeKey;

    const preview = await asLoggedInDataOwner(
      client.visit('api.import_previews.store'),
      await User.findOrFail(userId)
    )
      .json({ companyId, document: documentWithPrototypeKey })
      .send();

    preview.assertStatus(200);
    assert.isUndefined(({} as Record<string, unknown>).polluted);
    assert.notProperty(Object.prototype, 'polluted');
    assert.deepEqual(await readState(companyId, true), before);
    assert.equal(await revision(), revisionBefore);
    assert.deepEqual(await db.from('audit_entries').where('company_id', companyId), auditsBefore);
    assert.deepEqual(
      await db.from('planning_mutations').where('company_id', companyId),
      mutationsBefore
    );
  });

  test('a post-cleanup audit failure rolls back rows, restoration, marker and proof', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const deletion = await deleteForRestoration(client, cookie);
    const full = await document();
    full.data.companies[0]!.name += ' changed';
    const before = await readState(companyId, true);
    const groupBefore = await db.from('deleted_groups').where('group_id', deletion.groupId).first();
    const rowsBefore = await db.from('deleted_rows').where('group_id', deletion.groupId);
    const retainedBefore = await db.from('allocations').where('id', deletion.allocationId).first();
    const markerBefore = await db
      .from('planning_mutations')
      .where({
        company_id: companyId,
        mutation_id: deletion.mutationId,
      })
      .first();
    const baseRevision = await revision();
    assert.isNotNull(retainedBefore.deleted_at);
    assert.equal(retainedBefore.deletion_group_id, deletion.groupId);
    const confirmationId = await proof(client, cookie, {
      baseRevision,
      document: full,
    });
    await db.rawQuery(
      "CREATE TRIGGER fail_transfer_audit BEFORE INSERT ON audit_entries WHEN NEW.action = 'import' BEGIN SELECT RAISE(ABORT, 'forced transfer failure'); END"
    );
    try {
      const failed = await apply(client, cookie, full, baseRevision, confirmationId);
      assert.isAtLeast(failed.status(), 500);
      assert.deepEqual(await readState(companyId, true), before);
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
            company_id: companyId,
            mutation_id: deletion.mutationId,
          })
          .first(),
        markerBefore
      );
      assert.equal(await revision(), baseRevision);
      assert.lengthOf(
        await db.from('audit_entries').where({ company_id: companyId, action: 'import' }),
        0
      );
      const failedProofRow = await db
        .from('password_confirmations')
        .where('id', confirmationId)
        .first();
      assert.isNull(failedProofRow?.consumed_at);
    } finally {
      await db.rawQuery('DROP TRIGGER IF EXISTS fail_transfer_audit');
    }
    const retry = await apply(client, cookie, full, baseRevision, confirmationId);
    retry.assertStatus(200);
  });

  test('wrong password, role loss and revoked session cannot authorize import', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client);
    const full = await document();
    const baseRevision = await revision();
    const denied = await asDataOwner(client.visit('api.password_confirmations.store'), cookie)
      .json({
        action: 'import',
        companyId,
        intent: { baseRevision, document: full },
        password: 'incorrect-password',
      })
      .send();
    denied.assertStatus(403);
    assert.lengthOf(await db.from('password_confirmations'), 0);

    const roleProof = await proof(client, cookie, { baseRevision, document: full });
    await db
      .from('memberships')
      .where({ scope_id: companyId, user_id: userId })
      .update({ role: 'admin' });
    const roleDenied = await apply(client, cookie, full, baseRevision, roleProof);
    roleDenied.assertStatus(403);
    const previewDenied = await asDataOwner(client.visit('api.import_previews.store'), cookie)
      .json({ companyId, document: full })
      .send();
    previewDenied.assertStatus(403);
    assert.notProperty(previewDenied.body(), 'companyName');
    const roleProofRow = await db.from('password_confirmations').where('id', roleProof).first();
    assert.isNull(roleProofRow?.consumed_at);

    await db
      .from('memberships')
      .where({ scope_id: companyId, user_id: userId })
      .update({ role: 'owner' });
    const sessionProof = await proof(client, cookie, {
      baseRevision,
      document: full,
    });
    await db.from('account_sessions').where('user_id', userId).delete();
    const sessionDenied = await apply(client, cookie, full, baseRevision, sessionProof);
    sessionDenied.assertStatus(401);
    // A proof belongs to its sign-in and is removed with it.
    assert.isNull(await db.from('password_confirmations').where('id', sessionProof).first());
    assert.equal(await revision(), baseRevision);
  });

  test('credential replacement during verification cannot mint a proof', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client);
    const full = await document();
    const baseRevision = await revision();
    const { default: kit } = await import('@kevinjohn/adonisjs-account-kit/services/main');
    const originalVerify = hash.verify;
    const checking = Promise.withResolvers<void>();
    const pending = Promise.withResolvers<void>();
    let held = false;
    let changed = false;
    hash.verify = async function (...args: Parameters<typeof hash.verify>) {
      const result = await originalVerify.apply(this, args);
      if (!held) {
        held = true;
        checking.resolve();
        await pending.promise;
      }
      return result;
    };
    try {
      const request = asDataOwner(client.visit('api.password_confirmations.store'), cookie)
        .json({
          action: 'import',
          companyId,
          intent: { baseRevision, document: full },
          password,
        })
        .send();
      await checking.promise;
      await kit.emailPasswordManagement.changePassword({
        actorId: userId,
        currentPassword: password,
        newPassword: 'replacement-password-2026',
      });
      changed = true;
      pending.resolve();
      const response = await request;
      assert.include([401, 403], response.status());
      assert.isTrue(held);
      assert.lengthOf(await db.from('password_confirmations').where('user_id', userId), 0);
    } finally {
      pending.resolve();
      hash.verify = originalVerify;
      if (changed)
        await kit.emailPasswordManagement.changePassword({
          actorId: userId,
          currentPassword: 'replacement-password-2026',
          newPassword: password,
        });
    }
  });

  test('another live session and an expired proof cannot spend the same import confirmation', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const full = await document();
    const baseRevision = await revision();
    const confirmationId = await proof(client, cookie, {
      baseRevision,
      document: full,
    });
    const { cookie: secondCookie } = await signIn(client, 'bruce.wayne@wayne.example', password);
    const wrongSession = await apply(client, secondCookie, full, baseRevision, confirmationId);
    wrongSession.assertStatus(403);
    const unspent = await db.from('password_confirmations').where('id', confirmationId).first();
    assert.isNull(unspent?.consumed_at);
    await db
      .from('password_confirmations')
      .where('id', confirmationId)
      .update({
        verified_at: Date.now() - 5 * 60_000 - 1000,
      });
    const expired = await apply(client, cookie, full, baseRevision, confirmationId);
    expired.assertStatus(403);
    assert.equal(await revision(), baseRevision);
  });

  test('a recently verified import confirmation cannot spend after its stored deadline', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const full = await document();
    const baseRevision = await revision();
    const intent = { baseRevision, document: full };
    const confirmationId = await proof(client, cookie, intent);
    const confirmation = (id: string) => db.from('password_confirmations').where('id', id);
    const issued = await confirmation(confirmationId).firstOrFail();
    assert.equal(issued.expires_at - issued.verified_at, 5 * 60_000);
    await confirmation(confirmationId).update({ expires_at: Date.now() - 1 });

    const expired = await apply(client, cookie, full, baseRevision, confirmationId);
    expired.assertStatus(403);
    assert.deepEqual(expired.body(), {
      error: 'Confirm this action again.',
      code: 'E_PASSWORD_CONFIRMATION_REQUIRED',
    });
    const refused = await confirmation(confirmationId).firstOrFail();
    assert.equal(refused.verified_at, issued.verified_at);
    assert.isNull(refused.consumed_at);
    assert.equal(await revision(), baseRevision);

    const freshId = await proof(client, cookie, intent);
    const fresh = await apply(client, cookie, full, baseRevision, freshId);
    fresh.assertStatus(200);
    const spent = await confirmation(freshId).firstOrFail();
    assert.isNotNull(spent.consumed_at);
  });

  test('competing spends admit only one use of an exact import proof', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const full = await document();
    const baseRevision = await revision();
    const confirmationId = await proof(client, cookie, {
      baseRevision,
      document: full,
    });
    const responses = await Promise.all([
      apply(client, cookie, full, baseRevision, confirmationId),
      apply(client, cookie, full, baseRevision, confirmationId),
    ]);
    assert.deepEqual(responses.map((response) => response.status()).sort(), [200, 403]);
    assert.equal(await revision(), baseRevision);
  });
});
