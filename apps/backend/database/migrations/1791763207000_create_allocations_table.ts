import { BaseSchema } from '@adonisjs/lucid/schema'
import { guardCompany, retainDeletedRows, scoped } from '#database/migration_helpers'

export default class extends BaseSchema {
  protected tableName = 'allocations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      scoped(table)
      table
        .string('resource_id')
        .notNullable()
        .references('id')
        .inTable('resources')
        .onDelete('CASCADE')
      table
        .string('activity_id')
        .notNullable()
        .references('id')
        .inTable('activities')
        .onDelete('CASCADE')
      table
        .string('project_id')
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('SET NULL')
      table.date('start_date').notNullable()
      table.date('end_date').notNullable()
      table.float('hours_per_day').notNullable()
      table.string('status').notNullable()
      table.text('note').nullable()
      table.string('task').nullable()
      table.boolean('ignore_working_days').nullable()
      table.string('series_id').nullable()
      table.index(['resource_id'])
      table.index(['activity_id'])
      table.index(['project_id'])
      table.check("status IN ('confirmed','tentative','completed')")
      table.check('start_date <= end_date')
      table.check('hours_per_day >= 0 AND hours_per_day <= 24')
      table.check('ignore_working_days IS NULL OR ignore_working_days IN (0, 1)')
    })
    guardCompany(this.schema, this.tableName, [
      ['resource_id', 'resources'],
      ['activity_id', 'activities'],
      ['project_id', 'projects'],
    ])
    retainDeletedRows(this.schema, this.tableName)
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
