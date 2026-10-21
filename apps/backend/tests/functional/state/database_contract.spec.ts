import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import { seed } from '@capacitylens/shared/data/seed'
import { readState, replaceWithSeed, checkDatabase } from '#services/state_repository'
import { assertSchemaIntegrity } from '#services/schema_integrity'
import Account from '#models/account'
import { insertTenantFixture } from './database_contract_fixtures.js'
import {
  accountIndexes,
  baselineTables,
  crossAccountReferences,
  encodeFixture,
  expectedFixture,
  foreignKeyIndexes,
  fullFixtureRows,
  insertInvalidReference,
} from './database_contract_cases.js'

const accountIds = { dc: 'a-studio', marvel: 'a-loft' } as const
const stamp = '2026-10-12T00:00:00.000Z'

const scopedTables = [
  'clients',
  'disciplines',
  'projects',
  'phases',
  'resources',
  'activities',
  'allocations',
  'time_off',
  'closures',
] as const

async function rowCount(table: string, where: Record<string, string>) {
  const result = await db.from(table).where(where).count('* as count').first()
  return Number(result?.count ?? 0)
}

test.group('M1 database contract', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    await db.from('account_member_resources').delete()
    await replaceWithSeed()
    await insertTenantFixture()
  })

  test('creates the complete fresh baseline, including identity and control tables', async ({
    assert,
  }) => {
    const rows = await db.from('sqlite_master').select('name').where('type', 'table')
    assert.includeMembers(
      rows.map((row) => row.name as string),
      [...baselineTables]
    )
  })

  test('readiness refuses drifted login-link proof storage', async ({ assert }) => {
    await db.rawQuery(
      'ALTER TABLE login_link_tokens RENAME COLUMN client_challenge TO missing_challenge'
    )
    try {
      await assert.rejects(() => assertSchemaIntegrity(), /login_link_tokens columns differ/)
      await assert.rejects(() => checkDatabase(), /login_link_tokens columns differ/)
    } finally {
      await db.rawQuery(
        'ALTER TABLE login_link_tokens RENAME COLUMN missing_challenge TO client_challenge'
      )
    }
    await assertSchemaIntegrity()
  })

  test('round-trips every seeded entity through the migrated database read path', async ({
    assert,
  }) => {
    await replaceWithSeed()
    const actual = await readState()
    const expected = expectedFixture(seed()) as unknown as Record<string, unknown[]>
    for (const table of Object.keys(expected)) {
      const rows = actual[table as keyof typeof actual] as unknown as Array<Record<string, unknown>>
      const sortById = (entities: Array<Record<string, unknown>>) =>
        entities
          .map(expectedFixture)
          .sort((left, right) =>
            String((left as Record<string, unknown>).id).localeCompare(
              String((right as Record<string, unknown>).id)
            )
          )
      assert.deepEqual(
        sortById(rows),
        sortById(expected[table] as unknown as Array<Record<string, unknown>>),
        `${table} rows preserve their seeded fields`
      )
    }
  })

  test('keeps account discovery global while filtering scoped entity reads to one tenant', async ({
    assert,
  }) => {
    const accounts = await Account.all()
    assert.includeMembers(
      accounts.map((account) => account.id),
      [accountIds.dc, accountIds.marvel]
    )

    const state = await readState(accountIds.dc)
    assert.deepEqual(
      state.accounts.map((account) => account.id),
      [accountIds.dc]
    )
    for (const [table, rows] of Object.entries(state)) {
      if (table === 'accounts') continue
      assert.isTrue(
        (rows as Array<{ accountId: string }>).every((row) => row.accountId === accountIds.dc),
        `${table} contains only the requested tenant`
      )
    }

    const unknown = await readState('a-unknown')
    for (const [table, rows] of Object.entries(unknown))
      assert.lengthOf(rows, 0, `${table} is empty for an unknown tenant`)
  })

  test('scoped reads hide inactive lifecycle rows by default and can include them explicitly', async ({
    assert,
  }) => {
    await db.from('clients').where('id', 'm1-dc-client').update({ archived_at: stamp })
    await db.from('projects').where('id', 'm1-dc-project').update({ deleted_at: stamp })

    const active = await readState(accountIds.dc)
    assert.notInclude(
      active.clients.map((row) => row.id),
      'm1-dc-client'
    )
    assert.notInclude(
      active.projects.map((row) => row.id),
      'm1-dc-project'
    )

    const complete = await readState(accountIds.dc, true)
    assert.includeMembers(
      complete.clients.map((row) => row.id),
      ['m1-dc-client']
    )
    assert.includeMembers(
      complete.projects.map((row) => row.id),
      ['m1-dc-project']
    )
  })

  test('preserves boolean-looking and JSON-looking display names and notes as strings', async ({
    assert,
  }) => {
    const names = ['true', 'false', '[]', '{"hero":"Batman"}']
    await db.table('clients').insert(
      names.map((name, index) => ({
        id: `m1-string-client-${index}`,
        account_id: accountIds.dc,
        name,
        color: '#111111',
        created_at: stamp,
        updated_at: stamp,
      }))
    )
    const jsonLookingNote = '{"case":"preserve as text"}'
    await db.from('allocations').where('id', 'm1-dc-allocation').update({ note: jsonLookingNote })

    const state = await readState()
    for (const [index, name] of names.entries()) {
      const client = state.clients.find((row) => row.id === `m1-string-client-${index}`)
      assert.equal(client?.name, name)
    }
    assert.equal(
      state.allocations.find((row) => row.id === 'm1-dc-allocation')?.note,
      jsonLookingNote
    )
  })

  test('preserves canonical timestamps and the Unix epoch through model reads', async ({
    assert,
  }) => {
    const canonical = '2026-07-18T00:00:00.000Z'
    const epoch = '1970-01-01T00:00:00.000Z'
    await db.from('clients').where('id', 'm1-dc-client').update({
      created_at: canonical,
      updated_at: epoch,
    })

    const state = await readState()
    const client = state.clients.find((row) => row.id === 'm1-dc-client')
    assert.equal(client?.createdAt, canonical)
    assert.equal(client?.updatedAt, epoch)
  })

  test('rejects malformed and noncanonical persisted timestamps with their column locator', async ({
    assert,
  }) => {
    for (const createdAt of [
      'not-a-date',
      '2026-07-18T00:00:00Z',
      '2026-07-18T00:00:00.000+00:00',
    ]) {
      await db.from('clients').where('id', 'm1-dc-client').update({ created_at: createdAt })
      await assert.rejects(() => readState(), /Invalid persisted timestamp in clients\.created_at/)
    }
  })

  test('surfaces malformed persisted JSON in a known JSON column', async ({ assert }) => {
    await db.from('resources').where('id', 'm1-dc-resource').update({ working_days: '[1,2' })
    await assert.rejects(() => readState(), /Invalid persisted JSON in resources\.working_days/)
  })

  test('rejects valid JSON with invalid domain shapes at the owning column', async ({ assert }) => {
    for (const workingDays of ['[true]', '[8]']) {
      await db.from('resources').where('id', 'm1-dc-resource').update({ working_days: workingDays })
      await assert.rejects(() => readState(), /Invalid persisted JSON in resources\.working_days/)
    }

    await db
      .from('accounts')
      .where('id', accountIds.dc)
      .update({ capacity_overview_access: JSON.stringify('all_users') })
    await assert.rejects(
      () => readState(),
      /Invalid persisted JSON in accounts\.capacity_overview_access/
    )
  })

  test('rejects an invalid persisted availability date with its column locator', async ({
    assert,
  }) => {
    await db
      .from('resources')
      .where('id', 'm1-dc-resource')
      .update({ first_available_date: '2026-02-30' })
    await assert.rejects(
      () => readState(),
      /Invalid persisted date in resources\.first_available_date/
    )
  })

  test('round-trips populated optional fields and every entity variant from full fixtures', async ({
    assert,
  }) => {
    for (const [table, rows] of fullFixtureRows)
      for (const row of rows) await db.table(table).insert(encodeFixture(row))

    const actual = await readState()
    for (const [table, fixtures] of fullFixtureRows) {
      const rows = actual[
        table === 'time_off' ? 'timeOff' : (table as keyof typeof actual)
      ] as unknown as Array<Record<string, unknown>>
      for (const fixture of fixtures) {
        const actualRow = rows.find((row) => row.id === fixture.id)
        assert.isDefined(actualRow, `${table} ${fixture.id} is readable after persistence`)
        assert.deepEqual(
          expectedFixture(actualRow),
          expectedFixture(fixture),
          `${table} ${fixture.id} preserves populated fields`
        )
      }
    }
  })

  for (const [relationship, table, column, targetId] of crossAccountReferences) {
    test(`rejects cross-account ${relationship} inserts`, async ({ assert }) => {
      await assert.rejects(
        () => insertInvalidReference(table, column, targetId),
        /cross-account reference/
      )
      assert.deepEqual(await db.rawQuery('PRAGMA foreign_key_check'), [])
    })
  }

  test('rejects cross-account relationship updates while allowing NULL optional references', async ({
    assert,
  }) => {
    await assert.rejects(
      () =>
        db
          .from('allocations')
          .where('id', 'm1-dc-allocation')
          .update({ resource_id: 'm1-marvel-resource' }),
      /cross-account reference/
    )
    await db
      .from('resources')
      .where('id', 'm1-dc-resource')
      .update({ project_id: null, discipline_id: null })
    const resource = await db.from('resources').where('id', 'm1-dc-resource').first()
    assert.isNull(resource.project_id)
    assert.isNull(resource.discipline_id)
  })

  test('keeps tenant account identifiers immutable on every scoped entity table', async ({
    assert,
  }) => {
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
    ]
    for (const [index, table] of scopedTables.entries()) {
      await assert.rejects(
        () => db.from(table).where('id', ids[index]!).update({ account_id: accountIds.marvel }),
        /account_id is immutable/
      )
    }
  })

  test('preserves trigger enforcement bodies in the migrated schema', async ({ assert }) => {
    const triggers = await db.from('sqlite_master').select('name', 'sql').where('type', 'trigger')
    const byName = new Map(triggers.map((trigger) => [trigger.name as string, String(trigger.sql)]))
    for (const table of scopedTables) {
      const sql = byName.get(`${table}_account_immutable`)
      assert.isDefined(sql, `${table} account immutability trigger exists`)
      assert.match(sql!, /BEFORE\s+UPDATE\s+OF\s+account_id/i)
      assert.match(sql!, /NEW\.account_id\s*<>\s*OLD\.account_id/i)
      assert.match(sql!, /RAISE\s*\(\s*ABORT/i)
    }
    for (const [relationship, table, column, target] of [
      ['projects.client_id', 'projects', 'client_id', 'clients'],
      ['phases.project_id', 'phases', 'project_id', 'projects'],
      ['resources.discipline_id', 'resources', 'discipline_id', 'disciplines'],
      ['resources.project_id', 'resources', 'project_id', 'projects'],
      ['activities.project_id', 'activities', 'project_id', 'projects'],
      ['activities.phase_id', 'activities', 'phase_id', 'phases'],
      ['allocations.resource_id', 'allocations', 'resource_id', 'resources'],
      ['allocations.activity_id', 'allocations', 'activity_id', 'activities'],
      ['allocations.project_id', 'allocations', 'project_id', 'projects'],
      ['time_off.resource_id', 'time_off', 'resource_id', 'resources'],
    ] as const) {
      const insert = byName.get(`${table}_${column}_insert`)
      const update = byName.get(`${table}_${column}_update`)
      for (const [operation, sql] of [
        ['insert', insert],
        ['update', update],
      ] as const) {
        assert.isDefined(sql, `${relationship} ${operation} trigger exists`)
        assert.match(sql!, new RegExp(`BEFORE\\s+${operation}\\s+ON\\s+${table}`, 'i'))
        assert.match(sql!, new RegExp(`NEW\\.${column}\\s+IS\\s+NOT\\s+NULL`, 'i'))
        assert.match(
          sql!,
          new RegExp(`FROM\\s+${target}\\s+WHERE\\s+id\\s*=\\s*NEW\\.${column}`, 'i')
        )
        assert.match(sql!, /account_id\s*=\s*NEW\.account_id/i)
        assert.match(sql!, /RAISE\s*\(\s*ABORT\s*,\s*'cross-account reference'/i)
      }
    }
    const cleanupSql = byName.get('capacitylens_member_resource_kind_cleanup')
    assert.isDefined(cleanupSql, 'member/resource cleanup trigger exists')
    assert.match(cleanupSql!, /AFTER\s+UPDATE\s+OF\s+kind\s+ON\s+resources/i)
    assert.match(cleanupSql!, /OLD\.kind\s*=\s*'person'/i)
    assert.match(cleanupSql!, /NEW\.kind\s*<>\s*'person'/i)
    assert.match(cleanupSql!, /DELETE\s+FROM\s+account_member_resources/i)
    assert.match(cleanupSql!, /account_id\s*=\s*OLD\.account_id/i)
    assert.match(cleanupSql!, /resource_id\s*=\s*OLD\.id/i)
  })

  test('removes account member resource links when a person becomes a non-person', async ({
    assert,
  }) => {
    await db.table('account_member_resources').insert([
      {
        id: 'm1-dc-member-resource',
        account_id: accountIds.dc,
        user_id: 'm1-dc-user',
        resource_id: 'm1-dc-resource',
        revision: stamp,
        created_at: stamp,
        updated_at: stamp,
      },
      {
        id: 'm1-marvel-member-resource',
        account_id: accountIds.marvel,
        user_id: 'm1-marvel-user',
        resource_id: 'm1-marvel-resource',
        revision: stamp,
        created_at: stamp,
        updated_at: stamp,
      },
    ])
    await db.from('resources').where('id', 'm1-dc-resource').update({ kind: 'placeholder' })
    assert.equal(await rowCount('account_member_resources', { id: 'm1-dc-member-resource' }), 0)
    assert.equal(await rowCount('account_member_resources', { id: 'm1-marvel-member-resource' }), 1)
  })

  test('uses account-scoped member/resource uniqueness without foreign-key coupling', async ({
    assert,
  }) => {
    const association = {
      account_id: accountIds.dc,
      revision: stamp,
      created_at: stamp,
      updated_at: stamp,
    }
    await db.table('account_member_resources').insert({
      ...association,
      id: 'm1-association-1',
      user_id: 'm1-user-1',
      resource_id: 'm1-unlinked-resource',
    })
    await assert.rejects(
      () =>
        db.table('account_member_resources').insert({
          ...association,
          id: 'm1-association-2',
          user_id: 'm1-user-1',
          resource_id: 'm1-another-resource',
        }),
      /UNIQUE constraint failed/
    )
    await assert.rejects(
      () =>
        db.table('account_member_resources').insert({
          ...association,
          id: 'm1-association-3',
          user_id: 'm1-user-2',
          resource_id: 'm1-unlinked-resource',
        }),
      /UNIQUE constraint failed/
    )
    assert.deepEqual(await db.rawQuery('PRAGMA foreign_key_check'), [])
  })

  test('uses tenant indexes for account-scoped reads and deletes', async ({ assert }) => {
    for (const [table, column] of accountIndexes) {
      for (const operation of ['SELECT *', 'DELETE'] as const) {
        const query =
          operation === 'SELECT *'
            ? `EXPLAIN QUERY PLAN SELECT * FROM ${table} WHERE ${column} = ?`
            : `EXPLAIN QUERY PLAN DELETE FROM ${table} WHERE ${column} = ?`
        const plan = await db.rawQuery(query, [accountIds.dc])
        const details = JSON.stringify(plan)
        assert.match(
          details,
          /USING (?:COVERING )?INDEX/i,
          `${operation} on ${table} should use an index: ${details}`
        )
      }
    }
  })

  test('uses indexes for child-side foreign-key lookups', async ({ assert }) => {
    for (const [table, column] of foreignKeyIndexes) {
      const result = await db.rawQuery(
        `EXPLAIN QUERY PLAN SELECT id FROM ${table} WHERE ${column} = ?`,
        ['m1-parent-id']
      )
      const details = JSON.stringify(result)
      assert.match(
        details,
        /USING (?:COVERING )?INDEX/i,
        `lookup on ${table}.${column} should use an index: ${details}`
      )
    }
  })

  test('project deletion cascades descendants and clears surviving optional bindings', async ({
    assert,
  }) => {
    await db.from('projects').where('id', 'm1-dc-project').delete()
    assert.equal(await rowCount('projects', { id: 'm1-dc-project' }), 0)
    assert.equal(await rowCount('phases', { id: 'm1-dc-phase' }), 0)
    assert.equal(await rowCount('activities', { id: 'm1-dc-activity' }), 0)
    assert.equal(await rowCount('allocations', { id: 'm1-dc-allocation' }), 0)
    const resource = await db.from('resources').where('id', 'm1-dc-resource').first()
    assert.isNull(resource.project_id)
    const phaseSurvivor = await db
      .from('activities')
      .where('id', 'm1-dc-cross-phase-survivor')
      .first()
    assert.isNull(phaseSurvivor.phase_id)
    assert.equal(await rowCount('projects', { id: 'm1-marvel-project' }), 1)
  })

  test('client deletion cascades its project tree and leaves another client intact', async ({
    assert,
  }) => {
    await db.from('clients').where('id', 'm1-dc-client').delete()
    assert.equal(await rowCount('projects', { id: 'm1-dc-project' }), 0)
    assert.equal(await rowCount('phases', { id: 'm1-dc-phase' }), 0)
    assert.equal(await rowCount('activities', { id: 'm1-dc-activity' }), 0)
    assert.equal(await rowCount('clients', { id: 'm1-dc-client-2' }), 1)
    assert.equal(await rowCount('clients', { id: 'm1-marvel-client' }), 1)
  })

  test('resource deletion cascades allocations and time off without crossing accounts', async ({
    assert,
  }) => {
    await db.from('resources').where('id', 'm1-dc-resource').delete()
    assert.equal(await rowCount('allocations', { id: 'm1-dc-allocation' }), 0)
    assert.equal(await rowCount('time_off', { id: 'm1-dc-time-off' }), 0)
    assert.equal(await rowCount('resources', { id: 'm1-dc-resource-2' }), 1)
    assert.equal(await rowCount('allocations', { id: 'm1-marvel-allocation' }), 1)
  })

  test('discipline deletion clears the optional resource binding', async ({ assert }) => {
    await db.from('disciplines').where('id', 'm1-dc-discipline').delete()
    const resource = await db.from('resources').where('id', 'm1-dc-resource').first()
    assert.isNull(resource.discipline_id)
    assert.equal(await rowCount('resources', { id: 'm1-dc-resource' }), 1)
  })

  test('phase deletion clears bindings while activities and allocations survive', async ({
    assert,
  }) => {
    await db.from('phases').where('id', 'm1-dc-phase').delete()
    for (const id of [
      'm1-dc-activity',
      'm1-dc-unbound-project-activity',
      'm1-dc-cross-phase-survivor',
    ]) {
      assert.equal(await rowCount('activities', { id }), 1)
      const activity = await db.from('activities').where('id', id).first()
      assert.isNull(activity.phase_id)
    }
    assert.equal(await rowCount('allocations', { id: 'm1-dc-allocation' }), 1)
  })

  test('account deletion cascades exactly its scoped rows and preserves the other account', async ({
    assert,
  }) => {
    await db.from('accounts').where('id', accountIds.dc).delete()
    for (const table of scopedTables) {
      assert.equal(
        await rowCount(table, { account_id: accountIds.dc }),
        0,
        `${table} rows should cascade`
      )
      assert.isAbove(
        await rowCount(table, { account_id: accountIds.marvel }),
        0,
        `${table} keeps Marvel rows or seeded content`
      )
    }
  })

  test('readiness refuses a missing child-column index and accepts its restored definition', async ({
    assert,
  }) => {
    const index = await db
      .from('sqlite_master')
      .select('name', 'sql')
      .where('type', 'index')
      .where('tbl_name', 'projects')
      .whereNotNull('sql')
      .whereLike('sql', '%client_id%')
      .first()
    assert.isDefined(index?.sql, 'the projects.client_id child index exists')
    await db.rawQuery(`DROP INDEX "${String(index!.name)}"`)
    try {
      await assert.rejects(() => assertSchemaIntegrity(), /projects\.client_id index is missing/)
      await assert.rejects(() => checkDatabase(), /projects\.client_id index is missing/)
    } finally {
      await db.rawQuery(String(index!.sql))
    }
    await assertSchemaIntegrity()
  })

  test('readiness refuses a child index whose definition no longer covers the required column', async ({
    assert,
  }) => {
    const index = await db
      .from('sqlite_master')
      .select('name', 'sql')
      .where('type', 'index')
      .where('tbl_name', 'projects')
      .whereNotNull('sql')
      .whereLike('sql', '%client_id%')
      .first()
    assert.isDefined(index?.sql, 'the projects.client_id child index exists')
    await db.rawQuery(`DROP INDEX "${String(index!.name)}"`)
    await db.rawQuery(`CREATE INDEX "${String(index.name)}" ON projects(name)`)
    try {
      await assert.rejects(() => assertSchemaIntegrity(), /projects\.client_id index is missing/)
      await assert.rejects(() => checkDatabase(), /projects\.client_id index is missing/)
    } finally {
      await db.rawQuery(`DROP INDEX "${String(index.name)}"`)
      await db.rawQuery(String(index.sql))
    }
    await assertSchemaIntegrity()
  })

  test('readiness refuses a missing tenant account index', async ({ assert }) => {
    const index = await db
      .from('sqlite_master')
      .select('name', 'sql')
      .where('type', 'index')
      .where('tbl_name', 'clients')
      .whereNotNull('sql')
      .whereLike('sql', '%account_id%')
      .first()
    assert.isDefined(index?.sql, 'the clients.account_id tenant index exists')
    await db.rawQuery(`DROP INDEX "${String(index!.name)}"`)
    try {
      await assert.rejects(() => assertSchemaIntegrity(), /clients\.account_id index is missing/)
      await assert.rejects(() => checkDatabase(), /clients\.account_id index is missing/)
    } finally {
      await db.rawQuery(String(index!.sql))
    }
    await assertSchemaIntegrity()
  })

  test('readiness refuses a child index with its required column after the leading column', async ({
    assert,
  }) => {
    const index = await db
      .from('sqlite_master')
      .select('name', 'sql')
      .where('type', 'index')
      .where('tbl_name', 'projects')
      .whereNotNull('sql')
      .whereLike('sql', '%client_id%')
      .first()
    assert.isDefined(index?.sql, 'the projects.client_id child index exists')
    await db.rawQuery(`DROP INDEX "${String(index!.name)}"`)
    await db.rawQuery(`CREATE INDEX "${String(index!.name)}" ON projects(name, client_id)`)
    try {
      await assert.rejects(() => assertSchemaIntegrity(), /projects\.client_id index is missing/)
      await assert.rejects(() => checkDatabase(), /projects\.client_id index is missing/)
    } finally {
      await db.rawQuery(`DROP INDEX IF EXISTS "${String(index!.name)}"`)
      await db.rawQuery(String(index!.sql))
    }
    await assertSchemaIntegrity()
  })

  test('readiness refuses a partial child index for unrestricted foreign-key lookups', async ({
    assert,
  }) => {
    const index = await db
      .from('sqlite_master')
      .select('name', 'sql')
      .where('type', 'index')
      .where('tbl_name', 'projects')
      .whereNotNull('sql')
      .whereLike('sql', '%client_id%')
      .first()
    assert.isDefined(index?.sql, 'the projects.client_id child index exists')
    await db.rawQuery(`DROP INDEX "${String(index!.name)}"`)
    await db.rawQuery(
      `CREATE INDEX "${String(index!.name)}" ON projects(client_id) WHERE name = 'Gotham'`
    )
    try {
      await assert.rejects(() => assertSchemaIntegrity(), /projects\.client_id index is missing/)
      await assert.rejects(() => checkDatabase(), /projects\.client_id index is missing/)
    } finally {
      await db.rawQuery(`DROP INDEX IF EXISTS "${String(index!.name)}"`)
      await db.rawQuery(String(index!.sql))
    }
    await assertSchemaIntegrity()
  })

  test('readiness refuses a same-name tenant trigger with a drifted enforcement body', async ({
    assert,
  }) => {
    const triggerName = 'projects_client_id_insert'
    const trigger = await db
      .from('sqlite_master')
      .select('sql')
      .where('type', 'trigger')
      .where('name', triggerName)
      .first()
    assert.isDefined(trigger?.sql, `${triggerName} is installed`)
    await db.rawQuery(`DROP TRIGGER "${triggerName}"`)
    const dropped = await db
      .from('sqlite_master')
      .select('name')
      .where('type', 'trigger')
      .where('name', triggerName)
      .first()
    assert.isNull(dropped, `${triggerName} was dropped before replacing its definition`)
    await db.rawQuery(
      `CREATE TRIGGER "${triggerName}" BEFORE INSERT ON projects BEGIN SELECT 1; END`
    )
    try {
      await assert.rejects(() => assertSchemaIntegrity(), new RegExp(triggerName))
      await assert.rejects(() => checkDatabase(), new RegExp(triggerName))
    } finally {
      await db.rawQuery(`DROP TRIGGER IF EXISTS "${triggerName}"`)
      await db.rawQuery(String(trigger!.sql))
    }
    await assertSchemaIntegrity()
  })

  test('readiness detects case changes inside cleanup trigger string literals', async ({
    assert,
  }) => {
    const triggerName = 'capacitylens_member_resource_kind_cleanup'
    const trigger = await db
      .from('sqlite_master')
      .select('sql')
      .where('type', 'trigger')
      .where('name', triggerName)
      .first()
    assert.isDefined(trigger?.sql, `${triggerName} is installed`)
    const originalSql = String(trigger!.sql)
    const driftedSql = originalSql.replace("OLD.kind = 'person'", "OLD.kind = 'PERSON'")
    assert.notEqual(driftedSql, originalSql, 'the test changes a case-sensitive SQL literal')

    await db.rawQuery(`DROP TRIGGER "${triggerName}"`)
    try {
      await db.rawQuery(driftedSql)
      await assert.rejects(() => assertSchemaIntegrity(), new RegExp(triggerName))
      await assert.rejects(() => checkDatabase(), new RegExp(triggerName))
    } finally {
      await db.rawQuery(`DROP TRIGGER IF EXISTS "${triggerName}"`)
      await db.rawQuery(originalSql)
    }
    await assertSchemaIntegrity()
  })
})
