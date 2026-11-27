import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'company_planning_revisions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('company_id').primary().references('id').inTable('companies').onDelete('CASCADE')
      table.integer('revision').notNullable().defaultTo(0)
      table.check('revision >= 0')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
