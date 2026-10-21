import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // A group is one session's server-side before-image of a typed delete; restore consumes it once.
    this.schema.createTable('deleted_groups', (table) => {
      table.string('group_id').primary()
      table
        .string('account_id')
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
      table.string('actor_id').notNullable()
      table.string('session_id').notNullable()
      table.string('mutation_id').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('consumed_at').nullable()
      table.index(['account_id'])
      table.index(['session_id'])
    })
    this.schema.createTable('deleted_rows', (table) => {
      table.increments('id')
      table
        .string('group_id')
        .notNullable()
        .references('group_id')
        .inTable('deleted_groups')
        .onDelete('CASCADE')
      table.string('entity').notNullable()
      table.string('row_id').notNullable()
      table.text('payload_json').notNullable()
      table.unique(['group_id', 'entity', 'row_id'])
    })
  }
}
