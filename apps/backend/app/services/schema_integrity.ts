import db from '@adonisjs/lucid/services/db'

const relationships = [
  ['projects', 'client_id', 'clients'],
  ['phases', 'project_id', 'projects'],
  ['resources', 'discipline_id', 'disciplines'],
  ['resources', 'project_id', 'projects'],
  ['activities', 'project_id', 'projects'],
  ['activities', 'phase_id', 'phases'],
  ['allocations', 'resource_id', 'resources'],
  ['allocations', 'activity_id', 'activities'],
  ['allocations', 'project_id', 'projects'],
  ['time_off', 'resource_id', 'resources'],
] as const

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

const tenantIndexedTables = [...scopedTables, 'account_member_resources'] as const

const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().replace(/;$/, '')

async function assertIndex(table: string, column: string) {
  const indexes = (await db.rawQuery(`PRAGMA index_list(${table})`)) as Array<{
    name: string
    partial: number
  }>
  for (const { name, partial } of indexes) {
    if (partial !== 0) continue
    const columns = (await db.rawQuery(`PRAGMA index_info(${name})`)) as Array<{
      seqno: number
      name: string
    }>
    if (columns.sort((left, right) => left.seqno - right.seqno)[0]?.name === column) return
  }
  throw new Error(`Database schema drift: ${table}.${column} index is missing`)
}

async function assertTrigger(name: string, expectedSql: string) {
  const row = await db.from('sqlite_master').select('sql').where({ type: 'trigger', name }).first()
  if (typeof row?.sql !== 'string' || normalize(row.sql) !== normalize(expectedSql))
    throw new Error(`Database schema drift: trigger ${name} differs from the baseline`)
}

export async function assertSchemaIntegrity() {
  for (const table of tenantIndexedTables) await assertIndex(table, 'account_id')
  for (const [table, column] of relationships) await assertIndex(table, column)
  for (const table of scopedTables)
    await assertTrigger(
      `${table}_account_immutable`,
      `CREATE TRIGGER ${table}_account_immutable BEFORE UPDATE OF account_id ON ${table} WHEN NEW.account_id <> OLD.account_id BEGIN SELECT RAISE(ABORT, 'account_id is immutable'); END`
    )
  for (const [table, column, target] of relationships)
    for (const operation of ['INSERT', 'UPDATE'])
      await assertTrigger(
        `${table}_${column}_${operation.toLowerCase()}`,
        `CREATE TRIGGER ${table}_${column}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} WHEN NEW.${column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${target} WHERE id = NEW.${column} AND account_id = NEW.account_id) BEGIN SELECT RAISE(ABORT, 'cross-account reference'); END`
      )
  await assertTrigger(
    'capacitylens_member_resource_kind_cleanup',
    "CREATE TRIGGER capacitylens_member_resource_kind_cleanup AFTER UPDATE OF kind ON resources WHEN OLD.kind = 'person' AND NEW.kind <> 'person' BEGIN DELETE FROM account_member_resources WHERE account_id = OLD.account_id AND resource_id = OLD.id; END"
  )
  for (const [table, columns] of [
    ['capacitylens_sync_sessions', ['id', 'session_id', 'last_sequence', 'updated_at']],
    [
      'capacitylens_sync_row_provenance',
      ['id', 'table_name', 'row_id', 'account_id', 'session_id', 'sequence', 'row_hash'],
    ],
  ] as const) {
    const actual = (await db.rawQuery(`PRAGMA table_info(${table})`)) as Array<{ name: string }>
    if (JSON.stringify(actual.map((column) => column.name)) !== JSON.stringify(columns))
      throw new Error(`Database schema drift: ${table} columns differ from the baseline`)
  }
  await assertIndex('capacitylens_sync_sessions', 'session_id')
  await assertIndex('capacitylens_sync_row_provenance', 'table_name')
  await assertIndex('capacitylens_sync_row_provenance', 'session_id')
  await assertIndex('capacitylens_sync_row_provenance', 'account_id')
}
