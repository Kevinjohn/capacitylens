import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'password_confirmations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id', 36).primary()
      table
        .string('user_id', 254)
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      // Account Kit's sign-in registry row; a logout or credential change deletes it and its proofs.
      table
        .integer('sign_in_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('account_sessions')
        .onDelete('CASCADE')
      table.string('credential_revision', 64).nullable()
      table.string('action', 255).notNullable()
      // A `delete-account` confirmation is scoped to the person's own id, so the scope cannot
      // reference `companies`; confirmations last five minutes and are pruned globally.
      table.string('scope', 255).notNullable()
      table.string('intent_hash', 64).notNullable()
      // Epoch milliseconds.
      table.bigInteger('verified_at').notNullable()
      table.bigInteger('issued_at').notNullable()
      // The deadline returned at issuance; a later change to the window does not move it.
      table.bigInteger('expires_at').notNullable()
      table.bigInteger('consumed_at').nullable()
      table.index(['user_id'])
      table.index(['sign_in_id'])
      // prune(): expired by expires_at, spent by consumed_at.
      table.index(['expires_at'])
      table.index(['consumed_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
