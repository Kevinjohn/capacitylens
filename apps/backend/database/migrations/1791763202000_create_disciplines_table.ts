import { BaseSchema } from '@adonisjs/lucid/schema'
import { guardCompany, retainDeletedRows, scoped } from '#database/migration_helpers'

export default class extends BaseSchema {
  protected tableName = 'disciplines'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      scoped(table)
      table.string('name').notNullable()
      table.string('color').nullable()
      table.integer('sort_order').notNullable()
    })
    guardCompany(this.schema, this.tableName)
    retainDeletedRows(this.schema, this.tableName)
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
