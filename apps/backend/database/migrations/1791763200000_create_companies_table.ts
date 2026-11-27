import { BaseSchema } from '@adonisjs/lucid/schema'
import { metadata } from '#database/migration_helpers'

export default class extends BaseSchema {
  protected tableName = 'companies'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      metadata(table)
      table.string('name').notNullable()
      table.string('color').notNullable()
      table.string('scheduling_mode').nullable()
      table.string('timezone').nullable()
      table.json('week_starts_on').nullable()
      table.json('working_days').nullable()
      table.string('language').nullable()
      table.boolean('disciplines_enabled').nullable()
      table.boolean('placeholders_enabled').nullable()
      table.boolean('external_enabled').nullable()
      table.boolean('inline_activity_create_enabled').nullable()
      table.boolean('show_task_field_in_schedule').nullable()
      table.json('capacity_overview_access').nullable()
      table.string('date_style').nullable()
      table.check("scheduling_mode IS NULL OR scheduling_mode IN ('hourly','days','blocks')")
      table.check(
        "date_style IS NULL OR date_style IN ('day-month','day-ordinal-month','month-day','month-day-ordinal')"
      )
      table.check('disciplines_enabled IS NULL OR disciplines_enabled IN (0, 1)')
      table.check('placeholders_enabled IS NULL OR placeholders_enabled IN (0, 1)')
      table.check('external_enabled IS NULL OR external_enabled IN (0, 1)')
      table.check(
        'inline_activity_create_enabled IS NULL OR inline_activity_create_enabled IN (0, 1)'
      )
      table.check('show_task_field_in_schedule IS NULL OR show_task_field_in_schedule IN (0, 1)')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
