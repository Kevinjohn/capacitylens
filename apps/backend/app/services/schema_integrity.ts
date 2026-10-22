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

const tenantIndexedTables = [...scopedTables, 'account_member_resources', 'audit_entries'] as const

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

async function assertProofStorage(table: string, expectedColumns: string[]) {
  const columns = (await db.rawQuery(`PRAGMA table_info(${table})`)) as Array<{ name: string }>
  if (JSON.stringify(columns.map(({ name }) => name)) !== JSON.stringify(expectedColumns))
    throw new Error(`Database schema drift: ${table} columns differ from the baseline`)
  const references = (await db.rawQuery(`PRAGMA foreign_key_list(${table})`)) as Array<{
    table: string
    from: string
    to: string
    on_delete: string
  }>
  if (
    !references.some(
      (reference) =>
        reference.table === 'users' &&
        reference.from === 'tokenable_id' &&
        reference.to === 'id' &&
        reference.on_delete === 'CASCADE'
    )
  )
    throw new Error(`Database schema drift: ${table} user cascade is missing`)
  const indexes = (await db.rawQuery(`PRAGMA index_list(${table})`)) as Array<{
    name: string
    unique: number
    partial: number
  }>
  const uniqueColumns = new Set<string>()
  for (const index of indexes) {
    if (index.unique !== 1 || index.partial !== 0) continue
    const indexed = (await db.rawQuery(`PRAGMA index_info(${index.name})`)) as Array<{
      name: string
    }>
    if (indexed.length === 1) uniqueColumns.add(indexed[0]!.name)
  }
  if (!uniqueColumns.has('tokenable_id') || !uniqueColumns.has('hash'))
    throw new Error(`Database schema drift: ${table} proof uniqueness is missing`)
}

export async function assertSchemaIntegrity() {
  await assertProofStorage('login_link_tokens', [
    'id',
    'tokenable_id',
    'email',
    'hash',
    'client_challenge',
    'expires_at',
    'created_at',
  ])
  await assertProofStorage('password_reset_tokens', [
    'id',
    'tokenable_id',
    'email',
    'hash',
    'expires_at',
    'created_at',
  ])
  await assertProofStorage('email_verification_tokens', [
    'id',
    'tokenable_id',
    'email',
    'current_email',
    'purpose',
    'hash',
    'expires_at',
    'created_at',
  ])
  for (const table of tenantIndexedTables) await assertIndex(table, 'account_id')
  const auditColumns = (await db.rawQuery('PRAGMA table_info(audit_entries)')) as Array<{
    name: string
    notnull: number
  }>
  if (auditColumns.find((column) => column.name === 'account_id')?.notnull !== 1)
    throw new Error('Database schema drift: audit account_id must be required')
  const auditReferences = (await db.rawQuery('PRAGMA foreign_key_list(audit_entries)')) as Array<{
    table: string
  }>
  if (auditReferences.some((reference) => reference.table === 'accounts'))
    throw new Error('Database schema drift: deleted-company audit history must be retained')
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
  for (const table of [
    'account_getting_started_dismissals',
    'account_joining_policies',
    'company_join_intents',
    'account_access_restrictions',
    'member_resource_link_exceptions',
  ])
    await assertIndex(table, 'account_id')
  for (const [table, columns] of [
    ['account_getting_started_dismissals', ['id', 'account_id', 'created_at', 'updated_at']],
    [
      'account_joining_policies',
      ['id', 'account_id', 'policy', 'approved_domains', 'created_at', 'updated_at'],
    ],
    [
      'company_join_intents',
      [
        'id',
        'nonce_hash',
        'browser_hash',
        'purpose',
        'account_id',
        'invitation_id',
        'email',
        'principal_id',
        'provider_id',
        'state',
        'token_hash',
        'delivery_generation',
        'expires_at',
        'sent_count',
        'last_sent_at',
        'source_ip_hash',
        'provider_state_hash',
        'created_at',
        'updated_at',
      ],
    ],
    [
      'account_access_restrictions',
      ['id', 'account_id', 'principal_id', 'verified_email', 'role', 'created_at'],
    ],
    [
      'member_resource_link_exceptions',
      ['id', 'account_id', 'user_id', 'proposed_resource_id', 'reason', 'created_at', 'updated_at'],
    ],
  ] as const) {
    const actual = (await db.rawQuery(`PRAGMA table_info(${table})`)) as Array<{ name: string }>
    if (JSON.stringify(actual.map((column) => column.name)) !== JSON.stringify(columns))
      throw new Error(`Database schema drift: ${table} columns differ from the baseline`)
  }
}
