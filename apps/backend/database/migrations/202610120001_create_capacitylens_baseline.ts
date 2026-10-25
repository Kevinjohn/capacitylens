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

    // Account Kit's Lucid adapter maps these columns; password is the Adonis hasher's output.
    this.schema.createTable('users', (table) => {
      metadata(table)
      table.string('email', 254).notNullable().unique()
      table.string('display_name').nullable()
      table.string('password').nullable()
      table.timestamp('email_verified_at', { useTz: true, precision: 3 }).nullable()
      table.string('unverified_email', 254).nullable()
      // Milliseconds: two credential changes within one second must give different revisions.
      table.timestamp('credentials_changed_at', { useTz: true, precision: 3 }).nullable()
    })
    this.schema.createTable('account_sessions', (table) => {
      table.increments('id')
      table
        .string('user_id')
        .notNullable()
        .index()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('handle_hash', 64).notNullable().unique()
      table.string('label', 255).nullable()
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable()
      table.timestamp('last_seen_at', { useTz: true, precision: 3 }).notNullable()
      table.timestamp('expires_at', { useTz: true, precision: 3 }).notNullable()
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
    this.schema.createTable('ownership_transfers', (table) => {
      scoped(table)
      table.string('from_user_id').notNullable()
      table.string('to_user_id').notNullable()
      table.string('status').notNullable()
      table.integer('revision').notNullable()
    })
    this.schema.createTable('masquerades', (table) => {
      scoped(table)
      // Ending the Account Kit sign-in ends the view it opened.
      table
        .integer('session_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('account_sessions')
        .onDelete('CASCADE')
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
    // A group is one sign-in's server-side before-image of a typed delete; restore consumes it once.
    // Ending that sign-in deletes the group, so before-images never outlive the session.
    this.schema.createTable('deleted_groups', (table) => {
      table.string('group_id').primary()
      table
        .string('account_id')
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
      table.string('actor_id').notNullable()
      table
        .integer('session_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('account_sessions')
        .onDelete('CASCADE')
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
    this.schema.createTable('action_proofs', (table) => {
      table.string('id').primary()
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table
        .integer('session_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('account_sessions')
        .onDelete('CASCADE')
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

    this.schema.createTable('company_settings', (table) => {
      scoped(table)
      table.string('key').notNullable()
      table.json('value').nullable()
      table.unique(['account_id', 'key'])
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
    // Account Kit 0.1.2 requires this and the social tables below while those capabilities are
    // disabled: credential cleanup and pruning visit them. They stay empty.
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

    this.schema.createTable('social_identities', (table) => {
      table.increments('id')
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('provider', 64).notNullable()
      table.string('provider_user_id', 255).notNullable()
      table.string('email', 254).nullable()
      table.boolean('email_verified').notNullable().defaultTo(false)
      table.string('name', 255).nullable()
      table.string('nickname', 255).nullable()
      table.string('avatar_url', 2048).nullable()
      table.json('meta').nullable()
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable()
      table.timestamp('updated_at', { useTz: true, precision: 3 }).notNullable()
      table.timestamp('confirmed_at', { useTz: true, precision: 3 }).nullable()
      table.unique(['provider', 'provider_user_id'])
      table.index(['user_id'])
    })
    this.schema.createTable('social_transactions', (table) => {
      table.increments('id')
      table.string('hash', 64).notNullable().unique()
      table.string('provider', 64).notNullable()
      table.string('intent', 16).notNullable()
      table.string('purpose', 32).nullable()
      table.string('client_challenge', 43).notNullable()
      table.string('verification_hash', 64).nullable()
      table.string('proof_hash', 64).nullable()
      table.string('credential_revision', 40).nullable()
      table.string('user_id').nullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('provider_user_id', 255).nullable()
      table.string('email', 254).nullable()
      table.boolean('email_verified').nullable()
      table.string('name', 255).nullable()
      table.string('nickname', 255).nullable()
      table.string('avatar_url', 2048).nullable()
      table.timestamp('expires_at', { useTz: true, precision: 3 }).notNullable()
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable()
    })
    this.schema.createTable('social_sensitive_proofs', (table) => {
      table.increments('id')
      table.string('hash', 64).notNullable().unique()
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('purpose', 32).notNullable()
      table.string('credential_revision', 40).nullable()
      table.timestamp('expires_at', { useTz: true, precision: 3 }).notNullable()
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable()
      table.index(['user_id', 'purpose'])
    })
    this.schema.createTable('social_handoff_codes', (table) => {
      table.increments('id')
      table.string('hash', 64).notNullable().unique()
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table
        .integer('social_identity_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('social_identities')
        .onDelete('CASCADE')
      table.string('credential_revision', 40).nullable()
      table.string('client_challenge', 43).notNullable()
      table.timestamp('expires_at', { useTz: true, precision: 3 }).notNullable()
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable()
    })
    this.schema.createTable('account_invitations', (table) => {
      table.increments('id')
      table.string('email', 254).notNullable().unique()
      table.string('role', 64).notNullable()
      table.string('inviter_id').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.string('token_hash', 64).notNullable().unique()
      table.timestamp('expires_at', { useTz: true, precision: 3 }).notNullable()
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable()
      table.timestamp('updated_at', { useTz: true, precision: 3 }).notNullable()
      table.index(
        ['created_at', 'id', 'expires_at'],
        'account_invitations_created_at_id_expires_at_index'
      )
    })
    this.schema.createTable('account_admissions', (table) => {
      table.increments('id')
      // Null only on a bootstrap approval waiting for its account.
      table
        .string('user_id')
        .nullable()
        .unique()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('bootstrap_email', 254).nullable().unique()
      table.timestamp('requested_at', { useTz: true, precision: 3 }).nullable()
      // The consumed account_invitations id. No foreign key: acceptance deletes that row.
      table.integer('invitation_id').nullable()
      table.string('invited_email', 254).nullable()
      table.string('invited_role', 64).nullable()
      table.string('invitation_source', 16).nullable()
      table.timestamp('invitation_recorded_at', { useTz: true, precision: 3 }).nullable()
      table.string('approval_status', 16).nullable()
      table
        .string('approval_actor_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('approval_decided_at', { useTz: true, precision: 3 }).nullable()
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable()
      table.timestamp('updated_at', { useTz: true, precision: 3 }).notNullable()
      table.index(['created_at', 'id'], 'account_admissions_created_at_id_index')
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
      table.string('restoration_group_id').nullable()
      // The sign-in that may restore; no foreign key, so the marker outlives that sign-in.
      table.integer('origin_session_id').nullable()
      table.index(['account_id', 'actor_id', 'origin_session_id', 'restoration_group_id'])
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
