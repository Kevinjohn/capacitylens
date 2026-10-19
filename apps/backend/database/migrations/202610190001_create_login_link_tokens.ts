import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // Credential changes clear these proofs even while product magic-link sign-in is disabled.
    this.schema.createTable('login_link_tokens', (table) => {
      table.increments('id')
      table
        .string('tokenable_id')
        .notNullable()
        .unique()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('email', 254).notNullable()
      table.string('hash', 64).notNullable().unique()
      table.string('client_challenge', 43).notNullable()
      table.timestamp('expires_at', { useTz: true, precision: 3 }).notNullable()
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable()
    })
  }

  async down() {
    this.schema.dropTable('login_link_tokens')
  }
}
