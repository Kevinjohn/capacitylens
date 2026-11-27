import { type BaseSchema } from '@adonisjs/lucid/schema'

type SchemaBuilder = BaseSchema['schema']
type TableBuilder = Parameters<SchemaBuilder['createTable']>[1] extends (value: infer T) => void
  ? T
  : never

/** The planning tables whose rows a typed delete moves to trash rather than removing. */
export const retained = ['allocations', 'time_off', 'closures', 'phases', 'disciplines'] as const

/** Adds the string id and the creation and update timestamps every product row carries. */
export function metadata(table: TableBuilder) {
  table.string('id').primary()
  table.timestamp('created_at').notNullable()
  table.timestamp('updated_at').notNullable()
}

/** Adds the metadata columns and the indexed company id that scopes the row to one company. */
export function scoped(table: TableBuilder) {
  metadata(table)
  table.string('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE')
  table.index(['company_id'])
}

/**
 * Guards a scoped table's company boundary: each listed column may name only a row of the same
 * company, and the company id never changes. SQLite runs same-timing triggers newest first, so the
 * immutability check is created after the reference checks and reports a company change directly.
 */
export function guardCompany(
  schema: SchemaBuilder,
  table: string,
  references: ReadonlyArray<readonly [column: string, target: string]> = []
) {
  for (const [column, target] of references) {
    for (const operation of ['INSERT', 'UPDATE'] as const) {
      schema.raw(
        `CREATE TRIGGER ${table}_${column}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} WHEN NEW.${column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${target} WHERE id = NEW.${column} AND company_id = NEW.company_id) BEGIN SELECT RAISE(ABORT, 'cross-company reference'); END`
      )
    }
  }
  schema.raw(
    `CREATE TRIGGER ${table}_company_immutable BEFORE UPDATE OF company_id ON ${table} WHEN NEW.company_id <> OLD.company_id BEGIN SELECT RAISE(ABORT, 'company_id is immutable'); END`
  )
}

/**
 * Adds a retained table's trash marker and deletion group. The columns are added after the table
 * exists, so its foreign-key cascade order is kept, and after `guardCompany`, so these triggers run
 * before the company checks.
 */
export function retainDeletedRows(schema: SchemaBuilder, table: string) {
  schema.raw(`ALTER TABLE ${table} ADD COLUMN deleted_at TIMESTAMP`)
  schema.raw(
    `ALTER TABLE ${table} ADD COLUMN deletion_group_id VARCHAR REFERENCES deleted_groups(group_id) ON DELETE CASCADE`
  )
  schema.raw(`CREATE INDEX ${table}_deletion_group_id_index ON ${table}(deletion_group_id)`)
  for (const operation of ['INSERT', 'UPDATE'] as const) {
    schema.raw(
      `CREATE TRIGGER ${table}_deletion_group_${operation.toLowerCase()} BEFORE ${operation} ON ${table} WHEN NEW.deletion_group_id IS NOT NULL AND (NEW.deleted_at IS NULL OR NOT EXISTS (SELECT 1 FROM deleted_groups WHERE group_id = NEW.deletion_group_id AND company_id = NEW.company_id)) BEGIN SELECT RAISE(ABORT, 'invalid deletion group association'); END`
    )
  }
}
