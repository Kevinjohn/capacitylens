import { test } from '@japa/runner';
import { beforeFetch, beforeFind } from '@adonisjs/lucid/orm';
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model';
import db from '@adonisjs/lucid/services/db';
import { DateTime } from 'luxon';
import { freshDatabase } from '../../helpers/fresh_database.js';
import { resetAuthenticatedData } from '../../helpers/authenticated_data_fixture.js';
import { readState } from '#tests/helpers/state_fixture';
import { retainedQuery } from '#services/planning/retained_rows';
import Client from '#models/client';

class ClientWithLaterOrHooks extends Client {
  static table = 'clients';

  @beforeFind()
  static addFindOrCondition(query: ModelQueryBuilderContract<typeof ClientWithLaterOrHooks>) {
    void query.orWhere('name', 'Wayne Foundation');
  }

  @beforeFetch()
  static addFetchOrCondition(query: ModelQueryBuilderContract<typeof ClientWithLaterOrHooks>) {
    void query.orWhere('name', 'Wayne Foundation');
  }
}

test.group('soft-deleted rows', (group) => {
  group.setup(() => freshDatabase());

  test('keeps later subclass beforeFind and beforeFetch OR hooks inside the delete filter', async ({
    assert,
    client,
  }) => {
    await resetAuthenticatedData(client, 'single');
    const state = await readState('a-studio', true);
    const clientRow = state.clients.find((row) => row.builtin !== true)!;
    await db.from('clients').where('id', clientRow.id).update({
      name: 'Wayne Foundation',
      deleted_at: '2026-10-02T00:00:00.000Z',
    });

    assert.isNull(
      await ClientWithLaterOrHooks.query()
        .withScopes((scopes) => scopes.forCompany('a-studio'))
        .where('id', clientRow.id)
        .first()
    );
    assert.isEmpty(
      await ClientWithLaterOrHooks.query()
        .withScopes((scopes) => scopes.forCompany('a-studio'))
        .where('id', clientRow.id)
        .exec()
    );
    assert.isObject(
      await ClientWithLaterOrHooks.query()
        .withTrashed()
        .withScopes((scopes) => scopes.forCompany('a-studio'))
        .where('id', clientRow.id)
        .first()
    );
  });

  test('keeps a complete company read across model hooks while active projection hides descendants', async ({
    assert,
    client,
  }) => {
    await resetAuthenticatedData(client, true);
    const state = await readState('a-studio', true);
    const clientRow = state.clients.find((row) => row.builtin !== true)!;
    const project = state.projects.find((row) => row.clientId === clientRow.id)!;
    const activity = state.activities.find((row) => row.projectId === project.id)!;
    const deletedActivity = state.activities.find((row) => row.id !== activity.id)!;
    const deletedResource = state.resources[0]!;
    await db
      .from('clients')
      .where({ id: clientRow.id, account_id: 'a-studio' })
      .update({ deleted_at: '2026-10-02T00:00:00.000Z' });
    await db
      .from('projects')
      .where({ id: project.id, account_id: 'a-studio' })
      .update({ deleted_at: '2026-10-02T00:00:00.000Z' });
    await db
      .from('activities')
      .where({ id: deletedActivity.id, account_id: 'a-studio' })
      .update({ deleted_at: '2026-10-02T00:00:00.000Z' });
    await db
      .from('resources')
      .where({ id: deletedResource.id, account_id: 'a-studio' })
      .update({ deleted_at: '2026-10-02T00:00:00.000Z' });

    const trashed = await Client.query()
      .withTrashed()
      .withScopes((scopes) => scopes.forCompany('a-studio'))
      .where('id', clientRow.id)
      .firstOrFail();
    assert.isTrue(DateTime.isDateTime(trashed.deletedAt));
    assert.equal(trashed.serialize().deletedAt, '2026-10-02T00:00:00.000Z');
    const invalid = new Client();
    invalid.deletedAt = DateTime.invalid('test-invalid');
    assert.throws(
      () => invalid.serialize(),
      /Invalid soft-delete timestamp in model serialization/
    );

    const complete = await readState('a-studio', true);
    assert.equal(
      complete.clients.find((row) => row.id === clientRow.id)?.deletedAt,
      '2026-10-02T00:00:00.000Z'
    );
    assert.isString(complete.projects.find((row) => row.id === project.id)?.deletedAt);
    assert.isString(complete.activities.find((row) => row.id === deletedActivity.id)?.deletedAt);
    assert.isString(complete.resources.find((row) => row.id === deletedResource.id)?.deletedAt);
    assert.isTrue(complete.projects.some((row) => row.id === project.id));
    assert.isTrue(complete.activities.some((row) => row.id === activity.id));
    const projected = await readState('a-studio');
    assert.notInclude(
      projected.clients.map((row) => row.id),
      clientRow.id
    );
    assert.notInclude(
      projected.projects.map((row) => row.id),
      project.id
    );
    assert.notInclude(
      projected.activities.map((row) => row.id),
      activity.id
    );
    assert.notInclude(
      projected.activities.map((row) => row.id),
      deletedActivity.id
    );
    assert.notInclude(
      projected.resources.map((row) => row.id),
      deletedResource.id
    );
  });

  test('retained-row builders soft delete and purge only the selected company rows', async ({
    assert,
    client,
  }) => {
    await resetAuthenticatedData(client, true);
    const state = await readState(undefined, true);
    const [deletedLocal, activeLocal] = state.allocations.filter(
      (row) => row.accountId === 'a-studio'
    );
    const otherTenant = state.allocations.find((row) => row.accountId === 'a-loft')!;
    const before = await db.from('allocations').where('id', deletedLocal!.id).first();

    const softDeleted = await db.transaction((trx) =>
      retainedQuery(trx, 'a-studio', 'allocations')
        .whereIn('id', [deletedLocal!.id, otherTenant.id])
        .softDelete()
    );

    assert.equal(softDeleted, 1);
    const deleted = await db.from('allocations').where('id', deletedLocal!.id).first();
    assert.isNotNull(deleted.deleted_at);
    assert.equal(deleted.updated_at, before.updated_at);
    const untouched = await db.from('allocations').where('id', otherTenant.id).first();
    assert.isNull(untouched.deleted_at);

    await db
      .from('allocations')
      .where('id', otherTenant.id)
      .update({ deleted_at: '2026-10-02T00:00:00.000Z' });
    const purged = await db.transaction((trx) =>
      retainedQuery(trx, 'a-studio', 'allocations')
        .onlyTrashed()
        .whereIn('id', [deletedLocal!.id, activeLocal!.id, otherTenant.id])
        .forceDelete()
    );

    assert.equal(purged, 1);
    assert.isNull(await db.from('allocations').where('id', deletedLocal!.id).first());
    assert.isObject(await db.from('allocations').where('id', activeLocal!.id).first());
    assert.isObject(await db.from('allocations').where('id', otherTenant.id).first());
  });
});
