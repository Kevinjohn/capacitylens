import { BaseSchema } from '@adonisjs/lucid/schema'

const relationships = [
  ['projects', 'client_id', 'clients'],
  ['phases', 'project_id', 'projects'],
  ['resources', 'discipline_id', 'disciplines'],
  ['resources', 'project_id', 'projects'],
  ['activities', 'project_id', 'projects'],
  ['activities', 'phase_id', 'phases'],
  ['allocations', 'resource_id', 'resources'],
  ['allocations', 'activity_id', 'activities'],
  ['allocations', 'project_id', 'projects'],
  ['time_off', 'resource_id', 'resources'],
] as const

const scopedTables = [
  'clients',
  'disciplines',
  'projects',
  'phases',
  'resources',
  'activities',
  'allocations',
  'time_off',
  'closures',
] as const

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
      table.text('password_hash').nullable()
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
      table.bigint('authenticated_at').nullable()
      table.bigint('last_activity_at').nullable()
      table.unique('session_id')
    })
    this.schema.createTable('rate_limits', (table) => {
      table.string('key', 255).notNullable().primary()
      table.integer('points', 9).notNullable().defaultTo(0)
      table.bigint('expire').unsigned()
    })
    // Audit history outlives company deletion, so account_id carries no foreign key.
    this.schema.createTable('audit_entries', (table) => {
      table.string('id').primary()
      table.string('account_id').notNullable()
      table.string('actor_id').nullable()
      table.string('action').notNullable()
      table.string('entity').notNullable()
      table.string('entity_id').nullable()
      table.json('details').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
      table.index(['account_id'])
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
      table
        .string('target_user_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('token').nullable()
      table.timestamp('started_at').nullable()
    })
    this.schema.createTable('command_results', (table) => {
      metadata(table)
      table.string('account_id').nullable().references('id').inTable('accounts').onDelete('CASCADE')
      table.string('command_id').notNullable().unique()
      table.string('payload_hash').notNullable()
      table.json('result').notNullable()
      table.string('operation').nullable()
      table.string('idempotency_key').nullable()
      table.unique(['operation', 'idempotency_key'])
    })
    this.schema.createTable('company_settings', (table) => {
      scoped(table)
      table.string('key').notNullable()
      table.json('value').nullable()
      table.unique(['account_id', 'key'])
    })

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

    this.schema.createTable('adonis_sessions', (table) => {
      table.string('id').primary()
      table.text('data').notNullable()
      table.string('user_id').nullable().references('id').inTable('users').onDelete('CASCADE')
      table.timestamp('expires_at').notNullable()
      table.index('user_id')
      table.index('expires_at')
    })
    this.schema.createTable('password_reset_tokens', (table) => {
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

    this.schema.createTable('company_planning_revisions', (table) => {
      table.string('account_id').primary().references('id').inTable('accounts').onDelete('CASCADE')
      table.integer('revision').notNullable().defaultTo(0)
      table.check('revision >= 0')
    })
    this.schema.createTable('planning_mutations', (table) => {
      table
        .string('account_id')
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
      table.string('mutation_id').notNullable()
      table.string('actor_id').notNullable()
      table.integer('revision').notNullable()
      table.primary(['account_id', 'mutation_id'])
      table.check('revision >= 0')
    })

    for (const [table, column, target] of relationships) {
      for (const operation of ['INSERT', 'UPDATE'] as const) {
        this.schema.raw(
          `CREATE TRIGGER ${table}_${column}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} WHEN NEW.${column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${target} WHERE id = NEW.${column} AND account_id = NEW.account_id) BEGIN SELECT RAISE(ABORT, 'cross-account reference'); END`
        )
      }
    }
    // SQLite runs same-timing triggers newest first. Create this guard after relationship checks so
    // changing account_id always reports and enforces the immutable tenant boundary directly.
    for (const table of scopedTables) {
      this.schema.raw(
        `CREATE TRIGGER ${table}_account_immutable BEFORE UPDATE OF account_id ON ${table} WHEN NEW.account_id <> OLD.account_id BEGIN SELECT RAISE(ABORT, 'account_id is immutable'); END`
      )
    }
    this.schema.raw(
      "CREATE TRIGGER capacitylens_member_resource_kind_cleanup AFTER UPDATE OF kind ON resources WHEN OLD.kind = 'person' AND NEW.kind <> 'person' BEGIN DELETE FROM account_member_resources WHERE account_id = OLD.account_id AND resource_id = OLD.id; END"
    )
  }
}
