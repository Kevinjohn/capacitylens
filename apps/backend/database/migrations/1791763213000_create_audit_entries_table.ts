import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Audit history outlives company deletion, so company_id carries no foreign key.
 */
export default class extends BaseSchema {
  protected tableName = 'audit_entries'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary()
      table.string('company_id').notNullable()
      table.string('actor_id').nullable()
      table.string('operation').notNullable()
      table.string('entity').notNullable()
      table.string('entity_id').nullable()
      table.json('details').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
      table.index(['company_id', 'created_at'])
      table.index(['created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
