import { BaseSchema } from '@adonisjs/lucid/schema'

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

export default class extends BaseSchema {
  async up() {
    for (const [table, column, target] of relationships) {
      for (const operation of ['INSERT', 'UPDATE'] as const) {
        await this.db.rawQuery(
          `CREATE TRIGGER ${table}_${column}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} WHEN NEW.${column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${target} WHERE id = NEW.${column} AND account_id = NEW.account_id) BEGIN SELECT RAISE(ABORT, 'cross-account reference'); END`
        )
      }
    }
    // SQLite runs same-timing triggers newest first. Create this guard after relationship checks so
    // changing account_id always reports and enforces the immutable tenant boundary directly.
    for (const table of scopedTables) {
      await this.db.rawQuery(
        `CREATE TRIGGER ${table}_account_immutable BEFORE UPDATE OF account_id ON ${table} WHEN NEW.account_id <> OLD.account_id BEGIN SELECT RAISE(ABORT, 'account_id is immutable'); END`
      )
    }
    await this.db.rawQuery(
      "CREATE TRIGGER capacitylens_member_resource_kind_cleanup AFTER UPDATE OF kind ON resources WHEN OLD.kind = 'person' AND NEW.kind <> 'person' BEGIN DELETE FROM account_member_resources WHERE account_id = OLD.account_id AND resource_id = OLD.id; END"
    )
  }

  async down() {
    await this.db.rawQuery('DROP TRIGGER IF EXISTS capacitylens_member_resource_kind_cleanup')
    for (const [table, column] of relationships)
      for (const operation of ['insert', 'update'])
        await this.db.rawQuery(`DROP TRIGGER IF EXISTS ${table}_${column}_${operation}`)
    for (const table of scopedTables)
      await this.db.rawQuery(`DROP TRIGGER IF EXISTS ${table}_account_immutable`)
  }
}
