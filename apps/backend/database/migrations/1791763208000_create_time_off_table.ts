import { BaseSchema } from '@adonisjs/lucid/schema'
import { guardCompany, retainDeletedRows, scoped } from '#database/migration_helpers'

export default class extends BaseSchema {
  protected tableName = 'time_off'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      scoped(table)
      table
        .string('resource_id')
        .notNullable()
        .references('id')
        .inTable('resources')
        .onDelete('CASCADE')
      table.date('start_date').notNullable()
      table.date('end_date').notNullable()
      table.string('type').notNullable()
      table.text('note').nullable()
      table.index(['resource_id'])
      table.check("type IN ('holiday','sick','unpaid','other')")
      table.check('start_date <= end_date')
    })
    guardCompany(this.schema, this.tableName, [['resource_id', 'resources']])
    retainDeletedRows(this.schema, this.tableName)
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
