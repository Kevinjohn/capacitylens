import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.renameTable('account_recovery_tokens', 'password_reset_tokens')
    this.schema.alterTable('password_reset_tokens', (table) => {
      table.renameColumn('user_id', 'tokenable_id')
      table.renameColumn('token_hash', 'hash')
    })
    this.schema.createTable('email_verification_tokens', (table) => {
      table.increments('id')
      table
        .string('tokenable_id')
        .notNullable()
        .unique()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('email', 254).notNullable()
      table.string('current_email', 254).notNullable().defaultTo('')
      table.string('purpose', 32).notNullable().defaultTo('activation')
      table.string('hash', 64).notNullable().unique()
      table.timestamp('expires_at', { useTz: true }).notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
    })
    // Legacy email-change proofs stay inert: the product never supported that ceremony.
  }

  async down() {
    this.schema.dropTable('email_verification_tokens')
    this.schema.alterTable('password_reset_tokens', (table) => {
      table.renameColumn('tokenable_id', 'user_id')
      table.renameColumn('hash', 'token_hash')
    })
    this.schema.renameTable('password_reset_tokens', 'account_recovery_tokens')
  }
}
