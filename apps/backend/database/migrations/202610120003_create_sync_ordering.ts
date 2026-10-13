import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('capacitylens_sync_sessions', (table) => {
      table.increments('id')
      table.string('session_id').notNullable().unique()
      table.integer('last_sequence').notNullable()
      table.timestamp('updated_at').notNullable()
      table.check('last_sequence > 0')
    })
    this.schema.createTable('capacitylens_sync_row_provenance', (table) => {
      table.increments('id')
      table.string('table_name').notNullable()
      table.string('row_id').notNullable()
      table.string('account_id').notNullable()
      table.string('session_id').notNullable()
      table.integer('sequence').notNullable()
      table.string('row_hash', 64).notNullable()
      table.check('sequence > 0')
      table.unique(['table_name', 'row_id'])
      table.index(['session_id', 'sequence'])
      table.index(['account_id'])
    })
  }

  async down() {
    this.schema.dropTable('capacitylens_sync_row_provenance')
    this.schema.dropTable('capacitylens_sync_sessions')
  }
}
