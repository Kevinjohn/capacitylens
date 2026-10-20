import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'company_planning_revisions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('account_id').primary().references('id').inTable('accounts').onDelete('CASCADE')
      table.integer('revision').notNullable().defaultTo(0)
      table.check('revision >= 0')
    })

    this.schema.createTable('planning_mutations', (table) => {
      table
        .string('account_id')
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
      table.string('mutation_id').notNullable()
      table.string('actor_id').notNullable()
      table.integer('revision').notNullable()
      table.primary(['account_id', 'mutation_id'])
      table.check('revision >= 0')
    })
  }

  async down() {
    this.schema.dropTable('planning_mutations')
    this.schema.dropTable(this.tableName)
  }
}
