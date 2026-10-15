import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('account_getting_started_dismissals', (table) => {
      table.string('id').primary()
      table
        .string('account_id')
        .notNullable()
        .unique()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
    this.schema.createTable('account_joining_policies', (table) => {
      table.string('id').primary()
      table
        .string('account_id')
        .notNullable()
        .unique()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
      table
        .string('policy')
        .notNullable()
        .checkIn(['invitation_only', 'open', 'approved_domains', 'approved_domains_or_invitation'])
      table.json('approved_domains').notNullable().defaultTo('[]')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
    this.schema.createTable('company_join_intents', (table) => {
      table.string('id').primary()
      table.string('nonce_hash').notNullable().unique()
      table.string('browser_hash').notNullable()
      table.string('purpose').notNullable().checkIn(['policy', 'invitation'])
      table
        .string('account_id')
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
      table.index(['account_id'])
      table.string('invitation_id').nullable()
      table.string('email').notNullable()
      table.string('principal_id').nullable()
      table.string('provider_id').notNullable()
      table
        .string('state')
        .notNullable()
        .checkIn(['started', 'mail-sent', 'approved', 'completed', 'cancelled'])
      table.string('token_hash').nullable().unique()
      table.integer('delivery_generation').notNullable().defaultTo(0)
      table.bigInteger('expires_at').notNullable()
      table.integer('sent_count').notNullable().defaultTo(0)
      table.bigInteger('last_sent_at').nullable()
      table.string('source_ip_hash').notNullable()
      table.string('provider_state_hash').nullable().unique()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
      table.index(['email', 'last_sent_at'])
      table.index(['browser_hash', 'last_sent_at'])
      table.index(['source_ip_hash', 'last_sent_at'])
      table.index(['expires_at', 'state'])
      table.check(
        "(purpose = 'policy' AND invitation_id IS NULL) OR (purpose = 'invitation' AND invitation_id IS NOT NULL)"
      )
    })
    this.schema.createTable('account_access_restrictions', (table) => {
      table.string('id').primary()
      table
        .string('account_id')
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
      table.string('principal_id').notNullable()
      table.string('verified_email').nullable()
      table.string('role').notNullable().checkIn(['owner', 'admin', 'editor', 'viewer'])
      table.timestamp('created_at').notNullable()
      table.unique(['account_id', 'principal_id'])
      table.index(['account_id', 'verified_email'])
    })
    this.schema.createTable('member_resource_link_exceptions', (table) => {
      table.string('id').primary()
      table
        .string('account_id')
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
      table.string('user_id').notNullable()
      // A missing or deleted proposed resource remains a meaningful admission exception.
      table.string('proposed_resource_id').nullable()
      table
        .string('reason')
        .notNullable()
        .checkIn(['resource_unavailable', 'resource_already_linked', 'member_already_linked'])
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
      table.unique(['account_id', 'user_id'])
      table.index(['account_id'])
    })
  }

  async down() {
    this.schema.dropTable('member_resource_link_exceptions')
    this.schema.dropTable('account_access_restrictions')
    this.schema.dropTable('company_join_intents')
    this.schema.dropTable('account_joining_policies')
    this.schema.dropTable('account_getting_started_dismissals')
  }
}
