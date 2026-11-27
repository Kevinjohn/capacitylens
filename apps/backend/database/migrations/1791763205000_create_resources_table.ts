import { BaseSchema } from '@adonisjs/lucid/schema'
import { guardCompany, scoped } from '#database/migration_helpers'

export default class extends BaseSchema {
  protected tableName = 'resources'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      scoped(table)
      table.string('kind').notNullable()
      table.string('name').nullable()
      table.string('job_title').notNullable()
      table.string('avatar_url').nullable()
      table
        .string('discipline_id')
        .nullable()
        .references('id')
        .inTable('disciplines')
        .onDelete('SET NULL')
      table.string('employment_type').notNullable()
      table.string('engagement').notNullable()
      table.float('working_hours_per_day').notNullable()
      table.json('working_days').notNullable()
      table.json('half_days').notNullable()
      table
        .string('project_id')
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('SET NULL')
      table.string('color').notNullable()
      table.boolean('is_favourite').nullable()
      table.date('first_available_date').nullable()
      table.date('last_available_date').nullable()
      table.timestamp('archived_at').nullable()
      table.index(['discipline_id'])
      table.index(['project_id'])
      table.check("kind IN ('person','placeholder','external')")
      table.check("employment_type IN ('permanent','freelancer','contractor')")
      table.check("engagement IN ('studio','supplementary')")
      table.check(
        'first_available_date IS NULL OR last_available_date IS NULL OR first_available_date <= last_available_date'
      )
      table.check('is_favourite IS NULL OR is_favourite IN (0, 1)')
    })
    guardCompany(this.schema, this.tableName, [
      ['discipline_id', 'disciplines'],
      ['project_id', 'projects'],
    ])
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
