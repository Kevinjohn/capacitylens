import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => table.text('password_hash').nullable())
    this.schema.alterTable('user_session_index', (table) => {
      table.bigint('authenticated_at').nullable()
      table.bigint('last_activity_at').nullable()
      table.unique('session_id')
    })
    this.schema.alterTable('command_results', (table) => {
      table.string('operation').nullable()
      table.string('idempotency_key').nullable()
      table.unique(['operation', 'idempotency_key'])
    })

    // The baseline sessions table is retained for existing data and contract checks.
    this.schema.createTable('adonis_sessions', (table) => {
      table.string('id').primary()
      table.text('data').notNullable()
      table.string('user_id').nullable().references('id').inTable('users').onDelete('CASCADE')
      table.timestamp('expires_at').notNullable()
      table.index('user_id')
      table.index('expires_at')
    })

    // Limiter counters are transient; the prior column meanings cannot be carried into its store.
    this.schema.dropTable('rate_limits')
    this.schema.createTable('rate_limits', (table) => {
      table.string('key', 255).notNullable().primary()
      table.integer('points', 9).notNullable().defaultTo(0)
      table.bigint('expire').unsigned()
    })
    this.schema.createTable('account_recovery_tokens', (table) => {
      table.increments('id')
      table
        .string('user_id')
        .notNullable()
        .unique()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('email', 254).notNullable()
      table.string('token_hash', 64).notNullable().unique()
      table.timestamp('expires_at', { useTz: true }).notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
    })
    this.schema.createTable('account_email_changes', (table) => {
      table.increments('id')
      table
        .string('user_id')
        .notNullable()
        .unique()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('current_email', 254).notNullable()
      table.string('new_email', 254).notNullable()
      table.string('token_hash', 64).notNullable().unique()
      table.timestamp('expires_at', { useTz: true }).notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
    })
    this.schema.createTable('account_transaction_lock', (table) => {
      table.integer('id').primary()
      table.integer('version').notNullable().defaultTo(0)
    })
    this.defer(async (db) => {
      await db.table('account_transaction_lock').insert({ id: 1, version: 0 })
    })
  }

  async down() {
    this.schema.dropTable('account_transaction_lock')
    this.schema.dropTable('account_email_changes')
    this.schema.dropTable('account_recovery_tokens')
    this.schema.dropTable('rate_limits')
    this.schema.createTable('rate_limits', (table) => {
      table.string('id').primary()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
      table.string('key').notNullable().unique()
      table.integer('hits').notNullable()
      table.timestamp('reset_at').notNullable()
    })
    this.schema.dropTable('adonis_sessions')
    this.schema.alterTable('command_results', (table) => {
      table.dropUnique(['operation', 'idempotency_key'])
      table.dropColumn('operation')
      table.dropColumn('idempotency_key')
    })
    this.schema.alterTable('user_session_index', (table) => {
      table.dropUnique(['session_id'])
      table.dropColumn('authenticated_at')
      table.dropColumn('last_activity_at')
    })
    this.schema.alterTable('users', (table) => table.dropColumn('password_hash'))
  }
}
