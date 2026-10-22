import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('action_proofs', (table) => {
      table.string('id').primary()
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('session_id').notNullable()
      table
        .string('account_id')
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
      table.string('action').notNullable()
      table.string('intent_hash').notNullable()
      table.timestamp('expires_at').notNullable()
      table.timestamp('verified_at').nullable()
      table.timestamp('consumed_at').nullable()
      table.index(['user_id', 'session_id'])
    })
  }
}
