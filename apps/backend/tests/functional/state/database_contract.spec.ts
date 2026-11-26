import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { seed } from '@capacitylens/shared/data/seed';
import { readState, replaceWithSeed } from '#tests/helpers/state_fixture';
import Company from '#models/company';
import { ClientFactory } from '#database/factories/client_factory';
import { insertTwoCompanyFixture } from '#tests/functional/state/database_contract_fixtures';
import {
  ACTIVITY_KINDS,
  ALLOCATION_STATUSES,
  DATE_STYLES,
  EMPLOYMENT_TYPES,
  RESOURCE_ENGAGEMENTS,
  RESOURCE_KINDS,
  SCHEDULING_MODES,
  TIME_OFF_TYPES,
} from '@capacitylens/shared/types/entities';
import {
  companyIndexes,
  baselineTables,
  crossCompanyReferences,
  encodeFixture,
  expectedFixture,
  foreignKeyIndexes,
  fullFixtureRows,
  insertInvalidReference,
} from '#tests/functional/state/database_contract_cases';
import app from '@adonisjs/core/services/app';
import { DatabaseHealthService } from '#services/database_health_service';
import { SchemaIntegrityService } from '#services/schema_integrity_service';
import { companyIds, stamp, scopedTables, rowCount } from '#tests/helpers/state/database_contract';

const databaseHealth = await app.container.make(DatabaseHealthService);
const schemaIntegrity = new SchemaIntegrityService();

test.group('database contract', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await db.from('account_member_resources').delete();
    await replaceWithSeed();
    await insertTwoCompanyFixture();
  });

  test('creates the complete fresh schema, including identity and control tables', async ({
    assert,
  }) => {
    const journal = await db.from('adonis_schema').orderBy('id').select('name');
    const shipped = readdirSync(join(process.cwd(), 'database/migrations'))
      .filter((name) => name.endsWith('.ts'))
      .sort()
      .map((name) => `database/migrations/${name.slice(0, -'.ts'.length)}`);
    assert.equal(
      shipped[0],
      'database/migrations/1791763200000_create_capacitylens_baseline_table'
    );
    assert.deepEqual(
      journal.map((row) => row.name),
      shipped
    );
    const rows = await db.from('sqlite_master').select('name').where('type', 'table');
    assert.includeMembers(
      rows.map((row) => row.name as string),
      [...baselineTables]
    );
    assert.notInclude(
      rows.map((row) => row.name as string),
      'ownership_transfers'
    );
  });

  test('schema checks reject an unknown enum value or reversed date range')
    .with([
      { table: 'companies', id: companyIds.dc, values: { scheduling_mode: 'weekly' } },
      { table: 'companies', id: companyIds.dc, values: { date_style: 'iso' } },
      { table: 'resources', id: 'm1-dc-resource', values: { kind: 'robot' } },
      { table: 'resources', id: 'm1-dc-resource', values: { employment_type: 'intern' } },
      { table: 'resources', id: 'm1-dc-resource', values: { engagement: 'remote' } },
      {
        table: 'resources',
        id: 'm1-dc-resource',
        values: { first_available_date: '2026-02-01', last_available_date: '2026-01-01' },
      },
      { table: 'activities', id: 'm1-dc-activity', values: { kind: 'meeting' } },
      { table: 'allocations', id: 'm1-dc-allocation', values: { status: 'maybe' } },
      {
        table: 'allocations',
        id: 'm1-dc-allocation',
        values: { start_date: '2026-02-01', end_date: '2026-01-01' },
      },
      { table: 'allocations', id: 'm1-dc-allocation', values: { hours_per_day: 25 } },
      { table: 'allocations', id: 'm1-dc-allocation', values: { hours_per_day: -1 } },
      { table: 'time_off', id: 'm1-dc-time-off', values: { type: 'vacation' } },
      {
        table: 'time_off',
        id: 'm1-dc-time-off',
        values: { start_date: '2026-02-01', end_date: '2026-01-01' },
      },
      {
        table: 'closures',
        id: 'm1-dc-closure',
        values: { start_date: '2026-02-01', end_date: '2026-01-01' },
      },
      { table: 'companies', id: companyIds.dc, values: { disciplines_enabled: 'true' } },
      { table: 'companies', id: companyIds.dc, values: { placeholders_enabled: 'true' } },
      { table: 'companies', id: companyIds.dc, values: { external_enabled: 'true' } },
      { table: 'companies', id: companyIds.dc, values: { inline_activity_create_enabled: 'true' } },
      { table: 'companies', id: companyIds.dc, values: { show_task_field_in_schedule: 'true' } },
      { table: 'clients', id: 'm1-dc-client', values: { is_private: 'true' } },
      { table: 'clients', id: 'm1-dc-client', values: { builtin: 'true' } },
      { table: 'projects', id: 'm1-dc-project', values: { is_private: 'true' } },
      { table: 'resources', id: 'm1-dc-resource', values: { is_favourite: 'true' } },
      { table: 'allocations', id: 'm1-dc-allocation', values: { ignore_working_days: 2 } },
    ])
    .run(async ({ assert }, { table, id, values }) => {
      const source = await db.from(table).where('id', id).first();
      assert.isDefined(source);
      const copy = { ...source, id: `${id}-check-copy` };
      const error = await db
        .table(table)
        .insert({ ...copy, ...values })
        .then(
          () => undefined,
          (rejection: unknown) => rejection as { code?: string }
        );
      assert.equal(error?.code, 'SQLITE_CONSTRAINT_CHECK');
      // The same row without the bad value is accepted, so only that value failed the check.
      await db.table(table).insert(copy);
      await db.from(table).where('id', copy.id).delete();
    });

  test('each enum CHECK lists exactly the shared runtime list')
    .with([
      { table: 'companies', column: 'scheduling_mode', values: SCHEDULING_MODES },
      { table: 'companies', column: 'date_style', values: DATE_STYLES },
      { table: 'resources', column: 'kind', values: RESOURCE_KINDS },
      { table: 'resources', column: 'employment_type', values: EMPLOYMENT_TYPES },
      { table: 'resources', column: 'engagement', values: RESOURCE_ENGAGEMENTS },
      { table: 'activities', column: 'kind', values: ACTIVITY_KINDS },
      { table: 'allocations', column: 'status', values: ALLOCATION_STATUSES },
      { table: 'time_off', column: 'type', values: TIME_OFF_TYPES },
    ])
    .run(async ({ assert }, { table, column, values }) => {
      const row = await db
        .from('sqlite_master')
        .select('sql')
        .where({ type: 'table', name: table })
        .first();
      const list = new RegExp(`\\b${column} IN \\(([^)]*)\\)`).exec(String(row?.sql))?.[1];
      assert.isDefined(list, `${table}.${column} has an IN check`);
      assert.deepEqual(
        (list ?? '').split(',').map((value) => value.trim().replace(/^'|'$/g, '')),
        [...values]
      );
    });

  test('physical account deletion cascades only its idempotency receipts', async ({ assert }) => {
    const receipts = [companyIds.dc, companyIds.marvel].map((scopeId) => ({
      id: `receipt-${scopeId}`,
      scope_id: scopeId,
      command_id: `command-${scopeId}`,
      operation: JSON.stringify(['change-member-role', 'bruce-wayne']),
      request_key: `key-${scopeId}`,
      payload_hash: 'a'.repeat(64),
      state: 'completed',
      result: '{"ok":true}',
      created_at: stamp,
      updated_at: stamp,
    }));
    await db.table('request_receipts').insert(receipts);
    assert.lengthOf(
      await db.from('request_receipts').whereIn(
        'id',
        receipts.map((row) => row.id)
      ),
      2
    );
    await db.from('companies').where('id', companyIds.dc).delete();
    assert.isNull(await db.from('request_receipts').where('id', receipts[0]!.id).first());
    assert.isNotNull(await db.from('request_receipts').where('id', receipts[1]!.id).first());
  });

  test('readiness refuses a database with a shipped migration unrecorded', async ({ assert }) => {
    const record = await db.from('adonis_schema').orderBy('id').first();
    assert.isDefined(record);
    await db.from('adonis_schema').where('id', record!.id).delete();
    try {
      const unrecorded = new RegExp(`Database schema drift: .*${String(record!.name)}`);
      await assert.rejects(() => schemaIntegrity.assertSchemaIntegrity(), unrecorded);
      await assert.rejects(() => databaseHealth.checkDatabase(), unrecorded);
    } finally {
      await db.table('adonis_schema').insert(record!);
    }
  });

  test('readiness refuses a database without its migration record', async ({ assert }) => {
    await db.rawQuery('ALTER TABLE adonis_schema RENAME TO adonis_schema_moved');
    try {
      const missing = /Database schema drift: the migration record is missing/;
      await assert.rejects(() => schemaIntegrity.assertSchemaIntegrity(), missing);
      await assert.rejects(() => databaseHealth.checkDatabase(), missing);
    } finally {
      await db.rawQuery('ALTER TABLE adonis_schema_moved RENAME TO adonis_schema');
    }
  });

  test('readiness refuses a build that ships no migrations', async ({ assert }) => {
    const config = db.getRawConnection(db.primaryConnectionName)!.config;
    const migrations = config.migrations;
    const empty = mkdtempSync(join(tmpdir(), 'capacitylens-no-migrations-'));
    config.migrations = { ...migrations, paths: [empty] };
    try {
      await assert.rejects(
        () => schemaIntegrity.assertSchemaIntegrity(),
        /Database schema drift: this build ships no migrations to compare/
      );
    } finally {
      config.migrations = migrations;
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test('readiness accepts a freshly migrated database', async () => {
    await schemaIntegrity.assertSchemaIntegrity();
    await databaseHealth.checkDatabase();
  });

  test('round-trips every seeded entity through the migrated database read path', async ({
    assert,
  }) => {
    await replaceWithSeed();
    const actual = await readState();
    const expected = expectedFixture(seed()) as unknown as Record<string, unknown[]>;
    for (const table of Object.keys(expected)) {
      const rows = actual[table as keyof typeof actual] as unknown as Array<
        Record<string, unknown>
      >;
      const sortById = (entities: Array<Record<string, unknown>>) =>
        entities
          .map(expectedFixture)
          .sort((left, right) =>
            String((left as Record<string, unknown>).id).localeCompare(
              String((right as Record<string, unknown>).id)
            )
          );
      assert.deepEqual(
        sortById(rows),
        sortById(expected[table] as unknown as Array<Record<string, unknown>>),
        `${table} rows preserve their seeded fields`
      );
    }
  });

  test('keeps company discovery global while filtering scoped entity reads to one company', async ({
    assert,
  }) => {
    const companies = await Company.all();
    assert.includeMembers(
      companies.map((company) => company.id),
      [companyIds.dc, companyIds.marvel]
    );

    const state = await readState(companyIds.dc);
    assert.deepEqual(
      state.companies.map((company) => company.id),
      [companyIds.dc]
    );
    for (const [table, rows] of Object.entries(state)) {
      if (table === 'companies') continue;
      assert.isTrue(
        (rows as Array<{ companyId: string }>).every((row) => row.companyId === companyIds.dc),
        `${table} contains only the requested company`
      );
    }

    const unknown = await readState('a-unknown');
    for (const [table, rows] of Object.entries(unknown))
      assert.lengthOf(rows, 0, `${table} is empty for an unknown company`);
  });

  test('scoped reads hide inactive lifecycle rows by default and can include them explicitly', async ({
    assert,
  }) => {
    await db.from('clients').where('id', 'm1-dc-client').update({ archived_at: stamp });
    await db.from('projects').where('id', 'm1-dc-project').update({ archived_at: stamp });

    const active = await readState(companyIds.dc);
    assert.notInclude(
      active.clients.map((row) => row.id),
      'm1-dc-client'
    );
    assert.notInclude(
      active.projects.map((row) => row.id),
      'm1-dc-project'
    );

    const complete = await readState(companyIds.dc, true);
    assert.includeMembers(
      complete.clients.map((row) => row.id),
      ['m1-dc-client']
    );
    assert.includeMembers(
      complete.projects.map((row) => row.id),
      ['m1-dc-project']
    );
  });

  test('preserves boolean-looking and JSON-looking display names and notes as strings', async ({
    assert,
  }) => {
    const names = ['true', 'false', '[]', '{"hero":"Batman"}'];
    await ClientFactory.merge(
      names.map((name, index) => ({
        id: `m1-string-client-${index}`,
        companyId: companyIds.dc,
        name,
        color: '#111111',
      }))
    ).createMany(names.length);
    const jsonLookingNote = '{"case":"preserve as text"}';
    await db.from('allocations').where('id', 'm1-dc-allocation').update({ note: jsonLookingNote });

    const state = await readState();
    for (const [index, name] of names.entries()) {
      const client = state.clients.find((row) => row.id === `m1-string-client-${index}`);
      assert.equal(client?.name, name);
    }
    assert.equal(
      state.allocations.find((row) => row.id === 'm1-dc-allocation')?.note,
      jsonLookingNote
    );
  });

  test('preserves canonical timestamps and the Unix epoch through model reads', async ({
    assert,
  }) => {
    const canonical = '2026-07-18T00:00:00.000Z';
    const epoch = '1970-01-01T00:00:00.000Z';
    await db.from('clients').where('id', 'm1-dc-client').update({
      created_at: canonical,
      updated_at: epoch,
    });

    const state = await readState();
    const client = state.clients.find((row) => row.id === 'm1-dc-client');
    assert.equal(client?.createdAt, canonical);
    assert.equal(client?.updatedAt, epoch);
  });

  test('rejects malformed and noncanonical persisted timestamps with their column locator', async ({
    assert,
  }) => {
    for (const createdAt of [
      'not-a-date',
      '2026-07-18T00:00:00Z',
      '2026-07-18T00:00:00.000+00:00',
    ]) {
      await db.from('clients').where('id', 'm1-dc-client').update({ created_at: createdAt });
      await assert.rejects(() => readState(), /Invalid persisted timestamp in clients\.created_at/);
    }
  });

  test('surfaces malformed persisted JSON in a known JSON column', async ({ assert }) => {
    await db.from('resources').where('id', 'm1-dc-resource').update({ working_days: '[1,2' });
    await assert.rejects(() => readState(), /Invalid persisted JSON in resources\.working_days/);
  });

  test('rejects valid JSON with invalid domain shapes at the owning column', async ({ assert }) => {
    for (const workingDays of ['[true]', '[8]']) {
      await db
        .from('resources')
        .where('id', 'm1-dc-resource')
        .update({ working_days: workingDays });
      await assert.rejects(() => readState(), /Invalid persisted JSON in resources\.working_days/);
    }

    await db
      .from('companies')
      .where('id', companyIds.dc)
      .update({ capacity_overview_access: JSON.stringify('all_users') });
    await assert.rejects(
      () => readState(),
      /Invalid persisted JSON in companies\.capacity_overview_access/
    );
  });

  test('rejects an invalid persisted availability date with its column locator', async ({
    assert,
  }) => {
    await db
      .from('resources')
      .where('id', 'm1-dc-resource')
      .update({ first_available_date: '2026-02-30' });
    await assert.rejects(
      () => readState(),
      /Invalid persisted date in resources\.first_available_date/
    );
  });

  test('round-trips populated optional fields and every entity variant from full fixtures', async ({
    assert,
  }) => {
    for (const [table, rows] of fullFixtureRows)
      for (const row of rows) await db.table(table).insert(encodeFixture(row));

    const actual = await readState();
    for (const [table, fixtures] of fullFixtureRows) {
      const rows = actual[
        table === 'time_off' ? 'timeOff' : (table as keyof typeof actual)
      ] as unknown as Array<Record<string, unknown>>;
      for (const fixture of fixtures) {
        const actualRow = rows.find((row) => row.id === fixture.id);
        assert.isDefined(actualRow, `${table} ${fixture.id} is readable after persistence`);
        assert.deepEqual(
          expectedFixture(actualRow),
          expectedFixture(fixture),
          `${table} ${fixture.id} preserves populated fields`
        );
      }
    }
  });

  for (const [relationship, table, column, targetId] of crossCompanyReferences) {
    test(`rejects cross-company ${relationship} inserts`, async ({ assert }) => {
      await assert.rejects(
        () => insertInvalidReference(table, column, targetId),
        /cross-company reference/
      );
      assert.deepEqual(await db.rawQuery('PRAGMA foreign_key_check'), []);
    });
  }

  test('rejects cross-company relationship updates while allowing NULL optional references', async ({
    assert,
  }) => {
    await assert.rejects(
      () =>
        db
          .from('allocations')
          .where('id', 'm1-dc-allocation')
          .update({ resource_id: 'm1-marvel-resource' }),
      /cross-company reference/
    );
    await db
      .from('resources')
      .where('id', 'm1-dc-resource')
      .update({ project_id: null, discipline_id: null });
    const resource = await db.from('resources').where('id', 'm1-dc-resource').first();
    assert.isNull(resource.project_id);
    assert.isNull(resource.discipline_id);
  });

  test('keeps company identifiers immutable on every scoped entity table', async ({ assert }) => {
    const ids = [
      'm1-dc-client',
      'm1-dc-discipline',
      'm1-dc-project',
      'm1-dc-phase',
      'm1-dc-resource',
      'm1-dc-activity',
      'm1-dc-allocation',
      'm1-dc-time-off',
      'm1-dc-closure',
    ];
    for (const [index, table] of scopedTables.entries()) {
      await assert.rejects(
        () => db.from(table).where('id', ids[index]!).update({ company_id: companyIds.marvel }),
        /company_id is immutable/
      );
    }
  });

  test('removes company member resource links when a person becomes a non-person', async ({
    assert,
  }) => {
    await db.table('account_member_resources').insert([
      {
        id: 'm1-dc-member-resource',
        company_id: companyIds.dc,
        user_id: 'm1-dc-user',
        resource_id: 'm1-dc-resource',
        revision: stamp,
        created_at: stamp,
        updated_at: stamp,
      },
      {
        id: 'm1-marvel-member-resource',
        company_id: companyIds.marvel,
        user_id: 'm1-marvel-user',
        resource_id: 'm1-marvel-resource',
        revision: stamp,
        created_at: stamp,
        updated_at: stamp,
      },
    ]);
    await db.from('resources').where('id', 'm1-dc-resource').update({ kind: 'placeholder' });
    assert.equal(await rowCount('account_member_resources', { id: 'm1-dc-member-resource' }), 0);
    assert.equal(
      await rowCount('account_member_resources', { id: 'm1-marvel-member-resource' }),
      1
    );
  });

  test('uses company-scoped member/resource uniqueness without foreign-key coupling', async ({
    assert,
  }) => {
    const association = {
      company_id: companyIds.dc,
      revision: stamp,
      created_at: stamp,
      updated_at: stamp,
    };
    await db.table('account_member_resources').insert({
      ...association,
      id: 'm1-association-1',
      user_id: 'm1-user-1',
      resource_id: 'm1-unlinked-resource',
    });
    await assert.rejects(
      () =>
        db.table('account_member_resources').insert({
          ...association,
          id: 'm1-association-2',
          user_id: 'm1-user-1',
          resource_id: 'm1-another-resource',
        }),
      /UNIQUE constraint failed/
    );
    await assert.rejects(
      () =>
        db.table('account_member_resources').insert({
          ...association,
          id: 'm1-association-3',
          user_id: 'm1-user-2',
          resource_id: 'm1-unlinked-resource',
        }),
      /UNIQUE constraint failed/
    );
    assert.deepEqual(await db.rawQuery('PRAGMA foreign_key_check'), []);
  });

  test('uses company indexes for company-scoped reads and deletes', async ({ assert }) => {
    for (const [table, column] of companyIndexes) {
      for (const operation of ['SELECT *', 'DELETE'] as const) {
        const query =
          operation === 'SELECT *'
            ? `EXPLAIN QUERY PLAN SELECT * FROM ${table} WHERE ${column} = ?`
            : `EXPLAIN QUERY PLAN DELETE FROM ${table} WHERE ${column} = ?`;
        const plan = await db.rawQuery(query, [companyIds.dc]);
        const details = JSON.stringify(plan);
        assert.match(
          details,
          /USING (?:COVERING )?INDEX/i,
          `${operation} on ${table} should use an index: ${details}`
        );
      }
    }
  });

  test('uses indexes for child-side foreign-key lookups', async ({ assert }) => {
    for (const [table, column] of foreignKeyIndexes) {
      const result = await db.rawQuery(
        `EXPLAIN QUERY PLAN SELECT id FROM ${table} WHERE ${column} = ?`,
        ['m1-parent-id']
      );
      const details = JSON.stringify(result);
      assert.match(
        details,
        /USING (?:COVERING )?INDEX/i,
        `lookup on ${table}.${column} should use an index: ${details}`
      );
    }
  });

  test('project deletion cascades descendants and clears surviving optional bindings', async ({
    assert,
  }) => {
    await db.from('projects').where('id', 'm1-dc-project').delete();
    assert.equal(await rowCount('projects', { id: 'm1-dc-project' }), 0);
    assert.equal(await rowCount('phases', { id: 'm1-dc-phase' }), 0);
    assert.equal(await rowCount('activities', { id: 'm1-dc-activity' }), 0);
    assert.equal(await rowCount('allocations', { id: 'm1-dc-allocation' }), 0);
    const resource = await db.from('resources').where('id', 'm1-dc-resource').first();
    assert.isNull(resource.project_id);
    const phaseSurvivor = await db
      .from('activities')
      .where('id', 'm1-dc-cross-phase-survivor')
      .first();
    assert.isNull(phaseSurvivor.phase_id);
    assert.equal(await rowCount('projects', { id: 'm1-marvel-project' }), 1);
  });

  test('client deletion cascades its project tree and leaves another client intact', async ({
    assert,
  }) => {
    await db.from('clients').where('id', 'm1-dc-client').delete();
    assert.equal(await rowCount('projects', { id: 'm1-dc-project' }), 0);
    assert.equal(await rowCount('phases', { id: 'm1-dc-phase' }), 0);
    assert.equal(await rowCount('activities', { id: 'm1-dc-activity' }), 0);
    assert.equal(await rowCount('clients', { id: 'm1-dc-client-2' }), 1);
    assert.equal(await rowCount('clients', { id: 'm1-marvel-client' }), 1);
  });

  test('resource deletion cascades allocations and time off without crossing companies', async ({
    assert,
  }) => {
    await db.from('resources').where('id', 'm1-dc-resource').delete();
    assert.equal(await rowCount('allocations', { id: 'm1-dc-allocation' }), 0);
    assert.equal(await rowCount('time_off', { id: 'm1-dc-time-off' }), 0);
    assert.equal(await rowCount('resources', { id: 'm1-dc-resource-2' }), 1);
    assert.equal(await rowCount('allocations', { id: 'm1-marvel-allocation' }), 1);
  });

  test('discipline deletion clears the optional resource binding', async ({ assert }) => {
    await db.from('disciplines').where('id', 'm1-dc-discipline').delete();
    const resource = await db.from('resources').where('id', 'm1-dc-resource').first();
    assert.isNull(resource.discipline_id);
    assert.equal(await rowCount('resources', { id: 'm1-dc-resource' }), 1);
  });

  test('phase deletion clears bindings while activities and allocations survive', async ({
    assert,
  }) => {
    await db.from('phases').where('id', 'm1-dc-phase').delete();
    for (const id of [
      'm1-dc-activity',
      'm1-dc-unbound-project-activity',
      'm1-dc-cross-phase-survivor',
    ]) {
      assert.equal(await rowCount('activities', { id }), 1);
      const activity = await db.from('activities').where('id', id).first();
      assert.isNull(activity.phase_id);
    }
    assert.equal(await rowCount('allocations', { id: 'm1-dc-allocation' }), 1);
  });

  test('company deletion cascades exactly its scoped rows and preserves the other company', async ({
    assert,
  }) => {
    await db.from('companies').where('id', companyIds.dc).delete();
    for (const table of scopedTables) {
      assert.equal(
        await rowCount(table, { company_id: companyIds.dc }),
        0,
        `${table} rows should cascade`
      );
      assert.isAbove(
        await rowCount(table, { company_id: companyIds.marvel }),
        0,
        `${table} keeps Marvel rows or seeded content`
      );
    }
  });
});
