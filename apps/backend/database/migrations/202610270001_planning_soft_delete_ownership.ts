import { BaseSchema } from '@adonisjs/lucid/schema'

const retained = ['allocations', 'time_off', 'closures', 'phases', 'disciplines'] as const

export default class extends BaseSchema {
  // SQLite cannot change foreign_keys inside a transaction. We open our own transaction
  // after disabling enforcement and validate every reference before committing the rebuild.
  static disableTransactions = true

  async up() {
    await this.db.rawQuery('PRAGMA foreign_keys = OFF')
    try {
      await this.db.transaction(async (trx) => {
        const triggers = (await trx.rawQuery(
          "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL"
        )) as Array<{ name: string; sql: string }>
        for (const trigger of triggers) await trx.rawQuery(`DROP TRIGGER "${trigger.name}"`)

        // Keep the existing group table and its child receipts in place.
        await trx.rawQuery(
          'CREATE UNIQUE INDEX deleted_groups_account_group_unique ON deleted_groups(account_id, group_id)'
        )
        for (const name of retained) {
          await trx.schema.alterTable(name, (table) => {
            table.timestamp('deleted_at').nullable()
            table.string('deletion_group_id').nullable()
            table
              .foreign(['account_id', 'deletion_group_id'])
              .references(['account_id', 'group_id'])
              .inTable('deleted_groups')
              .onDelete('CASCADE')
            table.index(['deletion_group_id'])
          })
        }
        for (const trigger of triggers) await trx.rawQuery(trigger.sql)
        for (const name of retained) {
          await trx.rawQuery(
            `CREATE TRIGGER ${name}_deletion_group_insert BEFORE INSERT ON ${name} WHEN NEW.deletion_group_id IS NOT NULL AND NEW.deleted_at IS NULL BEGIN SELECT RAISE(ABORT, 'active row cannot belong to deletion group'); END`
          )
          await trx.rawQuery(
            `CREATE TRIGGER ${name}_deletion_group_update BEFORE UPDATE ON ${name} WHEN NEW.deletion_group_id IS NOT NULL AND NEW.deleted_at IS NULL BEGIN SELECT RAISE(ABORT, 'active row cannot belong to deletion group'); END`
          )
        }
        await trx.rawQuery(
          `CREATE TRIGGER deleted_groups_active_row_guard BEFORE DELETE ON deleted_groups WHEN ${retained.map((name) => `EXISTS (SELECT 1 FROM ${name} WHERE deletion_group_id = OLD.group_id AND deleted_at IS NULL)`).join(' OR ')} BEGIN SELECT RAISE(ABORT, 'active row cannot belong to deletion group'); END`
        )
        const violations = (await trx.rawQuery('PRAGMA foreign_key_check')) as unknown[]
        if (violations.length)
          throw new Error('Planning deletion migration would break foreign keys')
      })
    } finally {
      await this.db.rawQuery('PRAGMA foreign_keys = ON')
    }
  }
}
