import { BaseSchema } from '@adonisjs/lucid/schema'
import { guardCompany, scoped } from '#database/migration_helpers'

export default class extends BaseSchema {
  protected tableName = 'projects'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      scoped(table)
      table.string('name').notNullable()
      table
        .string('client_id')
        .notNullable()
        .references('id')
        .inTable('clients')
        .onDelete('CASCADE')
      table.index(['client_id'])
      table.string('color').notNullable()
      table.boolean('is_private').nullable()
      table.string('code_name').nullable()
      table.timestamp('archived_at').nullable()
      table.check('is_private IS NULL OR is_private IN (0, 1)')
    })
    guardCompany(this.schema, this.tableName, [['client_id', 'clients']])
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
