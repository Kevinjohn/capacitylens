import { BaseSchema } from '@adonisjs/lucid/schema'

const metadata = (
  table: Parameters<BaseSchema['schema']['createTable']>[1] extends (value: infer T) => void
    ? T
    : never
) => {
  table.string('id').primary()
  table.timestamp('created_at').notNullable()
  table.timestamp('updated_at').notNullable()
}

const scoped = (
  table: Parameters<BaseSchema['schema']['createTable']>[1] extends (value: infer T) => void
    ? T
    : never
) => {
  metadata(table)
  table.string('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE')
  table.index(['account_id'])
}

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('accounts', (table) => {
      metadata(table)
      table.string('name').notNullable()
      table.string('color').notNullable()
      table.string('scheduling_mode').nullable()
      table.string('timezone').nullable()
      table.json('week_starts_on').nullable()
      table.json('working_days').nullable()
      table.string('language').nullable()
      table.json('disciplines_enabled').nullable()
      table.json('placeholders_enabled').nullable()
      table.json('external_enabled').nullable()
      table.json('inline_activity_create_enabled').nullable()
      table.json('show_task_field_in_schedule').nullable()
      table.json('capacity_overview_access').nullable()
      table.string('date_style').nullable()
    })
    this.schema.createTable('clients', (table) => {
      scoped(table)
      table.string('name').notNullable()
      table.string('color').notNullable()
      table.json('is_private').nullable()
      table.string('code_name').nullable()
      table.json('builtin').nullable()
      table.timestamp('archived_at').nullable()
      table.timestamp('deleted_at').nullable()
    })
    this.schema.createTable('disciplines', (table) => {
      scoped(table)
      table.string('name').notNullable()
      table.string('color').nullable()
      table.integer('sort_order').notNullable()
    })
    this.schema.createTable('projects', (table) => {
      scoped(table)
      table.string('name').notNullable()
      table
        .string('client_id')
        .notNullable()
        .references('id')
        .inTable('clients')
        .onDelete('CASCADE')
      table.index(['client_id'])
      table.string('color').notNullable()
      table.json('is_private').nullable()
      table.string('code_name').nullable()
      table.timestamp('archived_at').nullable()
      table.timestamp('deleted_at').nullable()
    })
    this.schema.createTable('phases', (table) => {
      scoped(table)
      table.string('name').notNullable()
      table
        .string('project_id')
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')
      table.index(['project_id'])
    })
    this.schema.createTable('resources', (table) => {
      scoped(table)
      table.string('kind').notNullable()
      table.string('name').nullable()
      table.string('role').notNullable()
      table.string('avatar_url').nullable()
      table
        .string('discipline_id')
        .nullable()
        .references('id')
        .inTable('disciplines')
        .onDelete('SET NULL')
      table.string('employment_type').notNullable()
      table.string('engagement').notNullable()
      table.float('working_hours_per_day').notNullable()
      table.json('working_days').notNullable()
      table.json('half_days').notNullable()
      table
        .string('project_id')
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('SET NULL')
      table.string('color').notNullable()
      table.json('is_favourite').nullable()
      table.date('first_available_date').nullable()
      table.date('last_available_date').nullable()
      table.timestamp('archived_at').nullable()
      table.timestamp('deleted_at').nullable()
      table.index(['discipline_id'])
      table.index(['project_id'])
    })
    this.schema.createTable('activities', (table) => {
      scoped(table)
      table.string('name').notNullable()
      table.string('kind').notNullable()
      table.string('project_id').nullable().references('id').inTable('projects').onDelete('CASCADE')
      table.string('phase_id').nullable().references('id').inTable('phases').onDelete('SET NULL')
      table.timestamp('archived_at').nullable()
      table.timestamp('deleted_at').nullable()
      table.index(['project_id'])
      table.index(['phase_id'])
    })
    this.schema.createTable('allocations', (table) => {
      scoped(table)
      table
        .string('resource_id')
        .notNullable()
        .references('id')
        .inTable('resources')
        .onDelete('CASCADE')
      table
        .string('activity_id')
        .notNullable()
        .references('id')
        .inTable('activities')
        .onDelete('CASCADE')
      table
        .string('project_id')
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('SET NULL')
      table.date('start_date').notNullable()
      table.date('end_date').notNullable()
      table.float('hours_per_day').notNullable()
      table.string('status').notNullable()
      table.text('note').nullable()
      table.string('task').nullable()
      table.json('ignore_weekends').nullable()
      table.string('series_id').nullable()
      table.index(['resource_id'])
      table.index(['activity_id'])
      table.index(['project_id'])
    })
    this.schema.createTable('time_off', (table) => {
      scoped(table)
      table
        .string('resource_id')
        .notNullable()
        .references('id')
        .inTable('resources')
        .onDelete('CASCADE')
      table.date('start_date').notNullable()
      table.date('end_date').notNullable()
      table.string('type').notNullable()
      table.text('note').nullable()
      table.index(['resource_id'])
    })
    this.schema.createTable('closures', (table) => {
      scoped(table)
      table.string('name').notNullable()
      table.date('start_date').notNullable()
      table.date('end_date').notNullable()
    })

    this.schema.createTable('users', (table) => {
      metadata(table)
      table.string('email').notNullable().unique()
      table.boolean('email_verified').notNullable().defaultTo(false)
      table.string('display_name').nullable()
    })
    this.schema.createTable('provider_identities', (table) => {
      metadata(table)
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('provider').notNullable()
      table.string('issuer').notNullable()
      table.string('subject').notNullable()
      table.string('email').nullable()
      table.unique(['provider', 'issuer', 'subject'])
    })
    this.schema.createTable('email_proofs', (table) => {
      metadata(table)
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('email').notNullable()
      table.timestamp('verified_at').notNullable()
      table.unique(['user_id', 'email'])
    })
    this.schema.createTable('sessions', (table) => {
      metadata(table)
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.text('payload').nullable()
      table.timestamp('expires_at').notNullable()
    })
    this.schema.createTable('user_session_index', (table) => {
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('session_id').notNullable()
      table.primary(['user_id', 'session_id'])
    })
    this.schema.createTable('rate_limits', (table) => {
      metadata(table)
      table.string('key').notNullable().unique()
      table.integer('hits').notNullable()
      table.timestamp('reset_at').notNullable()
    })
    this.schema.createTable('audit_entries', (table) => {
      scoped(table)
      table.string('actor_id').nullable()
      table.string('action').notNullable()
      table.string('entity').notNullable()
      table.string('entity_id').nullable()
      table.json('details').nullable()
    })
    this.schema.createTable('memberships', (table) => {
      metadata(table)
      table
        .string('account_id')
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('role').notNullable()
      table.string('status').notNullable()
      table.unique(['account_id', 'user_id'])
    })
    this.schema.createTable('account_member_resources', (table) => {
      metadata(table)
      table.string('account_id').notNullable()
      table.string('user_id').notNullable()
      table.string('resource_id').notNullable()
      table.string('revision').notNullable()
      table.unique(['account_id', 'user_id'])
      table.unique(['account_id', 'resource_id'])
    })
    this.schema.createTable('invitations', (table) => {
      scoped(table)
      table.string('token_hash').notNullable().unique()
      table.string('email').nullable()
      table.string('role').notNullable()
      table.timestamp('expires_at').notNullable()
      table.timestamp('accepted_at').nullable()
    })
    this.schema.createTable('invitation_proposals', (table) => {
      metadata(table)
      table
        .string('invitation_id')
        .notNullable()
        .references('id')
        .inTable('invitations')
        .onDelete('CASCADE')
      table
        .string('resource_id')
        .nullable()
        .references('id')
        .inTable('resources')
        .onDelete('SET NULL')
      table.unique(['invitation_id'])
    })
    this.schema.createTable('ownership_transfers', (table) => {
      scoped(table)
      table.string('from_user_id').notNullable()
      table.string('to_user_id').notNullable()
      table.string('status').notNullable()
      table.integer('revision').notNullable()
    })
    this.schema.createTable('masquerades', (table) => {
      scoped(table)
      table.string('session_id').notNullable()
      table.string('actor_user_id').notNullable()
      table.string('role').notNullable()
      table.unique(['session_id'])
    })
    this.schema.createTable('command_results', (table) => {
      metadata(table)
      table.string('account_id').nullable().references('id').inTable('accounts').onDelete('CASCADE')
      table.string('command_id').notNullable().unique()
      table.string('payload_hash').notNullable()
      table.json('result').notNullable()
    })
    this.schema.createTable('company_settings', (table) => {
      scoped(table)
      table.string('key').notNullable()
      table.json('value').nullable()
      table.unique(['account_id', 'key'])
    })
  }

  async down() {
    for (const table of [
      'company_settings',
      'command_results',
      'masquerades',
      'ownership_transfers',
      'invitation_proposals',
      'invitations',
      'memberships',
      'account_member_resources',
      'audit_entries',
      'rate_limits',
      'user_session_index',
      'sessions',
      'email_proofs',
      'provider_identities',
      'users',
      'closures',
      'time_off',
      'allocations',
      'activities',
      'resources',
      'phases',
      'projects',
      'disciplines',
      'clients',
      'accounts',
    ])
      this.schema.dropTable(table)
  }
}
