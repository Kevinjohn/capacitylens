import { BaseSchema } from '@adonisjs/lucid/schema';
import { createMasqueradeSchema } from '@kevinjohn/adonisjs-masquerade/stores/lucid';

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
] as const;

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
] as const;

/** Planning rows a typed delete moves to trash rather than removing. */
const retained = ['allocations', 'time_off', 'closures', 'phases', 'disciplines'] as const;

const metadata = (
  table: Parameters<BaseSchema['schema']['createTable']>[1] extends (value: infer T) => void
    ? T
    : never
) => {
  table.string('id').primary();
  table.timestamp('created_at').notNullable();
  table.timestamp('updated_at').notNullable();
};

const scoped = (
  table: Parameters<BaseSchema['schema']['createTable']>[1] extends (value: infer T) => void
    ? T
    : never
) => {
  metadata(table);
  table.string('company_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
  table.index(['company_id']);
};

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('accounts', (table) => {
      metadata(table);
      table.string('name').notNullable();
      table.string('color').notNullable();
      table.string('scheduling_mode').nullable();
      table.string('timezone').nullable();
      table.json('week_starts_on').nullable();
      table.json('working_days').nullable();
      table.string('language').nullable();
      table.boolean('disciplines_enabled').nullable();
      table.boolean('placeholders_enabled').nullable();
      table.boolean('external_enabled').nullable();
      table.boolean('inline_activity_create_enabled').nullable();
      table.boolean('show_task_field_in_schedule').nullable();
      table.json('capacity_overview_access').nullable();
      table.string('date_style').nullable();
      table.check("scheduling_mode IS NULL OR scheduling_mode IN ('hourly','days','blocks')");
      table.check(
        "date_style IS NULL OR date_style IN ('day-month','day-ordinal-month','month-day','month-day-ordinal')"
      );
      table.check('disciplines_enabled IS NULL OR disciplines_enabled IN (0, 1)');
      table.check('placeholders_enabled IS NULL OR placeholders_enabled IN (0, 1)');
      table.check('external_enabled IS NULL OR external_enabled IN (0, 1)');
      table.check(
        'inline_activity_create_enabled IS NULL OR inline_activity_create_enabled IN (0, 1)'
      );
      table.check('show_task_field_in_schedule IS NULL OR show_task_field_in_schedule IN (0, 1)');
    });
    this.schema.createTable('clients', (table) => {
      scoped(table);
      table.string('name').notNullable();
      table.string('color').notNullable();
      table.boolean('is_private').nullable();
      table.string('code_name').nullable();
      table.boolean('builtin').nullable();
      table.timestamp('archived_at').nullable();
      table.timestamp('deleted_at').nullable();
      table.check('is_private IS NULL OR is_private IN (0, 1)');
      table.check('builtin IS NULL OR builtin IN (0, 1)');
    });
    this.schema.createTable('disciplines', (table) => {
      scoped(table);
      table.string('name').notNullable();
      table.string('color').nullable();
      table.integer('sort_order').notNullable();
    });
    this.schema.createTable('projects', (table) => {
      scoped(table);
      table.string('name').notNullable();
      table
        .string('client_id')
        .notNullable()
        .references('id')
        .inTable('clients')
        .onDelete('CASCADE');
      table.index(['client_id']);
      table.string('color').notNullable();
      table.boolean('is_private').nullable();
      table.string('code_name').nullable();
      table.timestamp('archived_at').nullable();
      table.timestamp('deleted_at').nullable();
      table.check('is_private IS NULL OR is_private IN (0, 1)');
    });
    this.schema.createTable('phases', (table) => {
      scoped(table);
      table.string('name').notNullable();
      table
        .string('project_id')
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE');
      table.index(['project_id']);
    });
    this.schema.createTable('resources', (table) => {
      scoped(table);
      table.string('kind').notNullable();
      table.string('name').nullable();
      table.string('role').notNullable();
      table.string('avatar_url').nullable();
      table
        .string('discipline_id')
        .nullable()
        .references('id')
        .inTable('disciplines')
        .onDelete('SET NULL');
      table.string('employment_type').notNullable();
      table.string('engagement').notNullable();
      table.float('working_hours_per_day').notNullable();
      table.json('working_days').notNullable();
      table.json('half_days').notNullable();
      table
        .string('project_id')
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('SET NULL');
      table.string('color').notNullable();
      table.boolean('is_favourite').nullable();
      table.date('first_available_date').nullable();
      table.date('last_available_date').nullable();
      table.timestamp('archived_at').nullable();
      table.timestamp('deleted_at').nullable();
      table.index(['discipline_id']);
      table.index(['project_id']);
      table.check("kind IN ('person','placeholder','external')");
      table.check("employment_type IN ('permanent','freelancer','contractor')");
      table.check("engagement IN ('studio','supplementary')");
      table.check(
        'first_available_date IS NULL OR last_available_date IS NULL OR first_available_date <= last_available_date'
      );
      table.check('is_favourite IS NULL OR is_favourite IN (0, 1)');
    });
    this.schema.createTable('activities', (table) => {
      scoped(table);
      table.string('name').notNullable();
      table.string('kind').notNullable();
      table
        .string('project_id')
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE');
      table.string('phase_id').nullable().references('id').inTable('phases').onDelete('SET NULL');
      table.timestamp('archived_at').nullable();
      table.timestamp('deleted_at').nullable();
      table.index(['project_id']);
      table.index(['phase_id']);
      table.check("kind IN ('project','internal','repeatable')");
    });
    this.schema.createTable('allocations', (table) => {
      scoped(table);
      table
        .string('resource_id')
        .notNullable()
        .references('id')
        .inTable('resources')
        .onDelete('CASCADE');
      table
        .string('activity_id')
        .notNullable()
        .references('id')
        .inTable('activities')
        .onDelete('CASCADE');
      table
        .string('project_id')
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('SET NULL');
      table.date('start_date').notNullable();
      table.date('end_date').notNullable();
      table.float('hours_per_day').notNullable();
      table.string('status').notNullable();
      table.text('note').nullable();
      table.string('task').nullable();
      table.boolean('ignore_working_days').nullable();
      table.string('series_id').nullable();
      table.index(['resource_id']);
      table.index(['activity_id']);
      table.index(['project_id']);
      table.check("status IN ('confirmed','tentative','completed')");
      table.check('start_date <= end_date');
      table.check('hours_per_day >= 0 AND hours_per_day <= 24');
      table.check('ignore_working_days IS NULL OR ignore_working_days IN (0, 1)');
    });
    this.schema.createTable('time_off', (table) => {
      scoped(table);
      table
        .string('resource_id')
        .notNullable()
        .references('id')
        .inTable('resources')
        .onDelete('CASCADE');
      table.date('start_date').notNullable();
      table.date('end_date').notNullable();
      table.string('type').notNullable();
      table.text('note').nullable();
      table.index(['resource_id']);
      table.check("type IN ('holiday','sick','unpaid','other')");
      table.check('start_date <= end_date');
    });
    this.schema.createTable('closures', (table) => {
      scoped(table);
      table.string('name').notNullable();
      table.date('start_date').notNullable();
      table.date('end_date').notNullable();
      table.check('start_date <= end_date');
    });

    // Account Kit's Lucid adapter maps these columns; password is the Adonis hasher's output.
    this.schema.createTable('users', (table) => {
      metadata(table);
      table.string('email', 254).notNullable().unique();
      table.string('display_name').nullable();
      table.string('password').nullable();
      table.timestamp('email_verified_at', { useTz: true, precision: 3 }).nullable();
      table.string('unverified_email', 254).nullable();
      // Milliseconds: two credential changes within one second must give different revisions.
      table.timestamp('credentials_changed_at', { useTz: true, precision: 3 }).nullable();
    });
    this.schema.createTable('account_sessions', (table) => {
      table.increments('id');
      table
        .string('user_id')
        .notNullable()
        .index()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE');
      table.string('handle_hash', 64).notNullable().unique();
      table.string('label', 255).nullable();
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable();
      table.timestamp('last_seen_at', { useTz: true, precision: 3 }).notNullable();
      table.timestamp('expires_at', { useTz: true, precision: 3 }).notNullable();
    });
    this.schema.createTable('rate_limits', (table) => {
      table.string('key', 255).notNullable().primary();
      table.integer('points', 9).notNullable().defaultTo(0);
      table.bigint('expire').unsigned();
    });
    // Audit history outlives company deletion, so company_id carries no foreign key.
    this.schema.createTable('audit_entries', (table) => {
      table.string('id').primary();
      table.string('company_id').notNullable();
      table.string('actor_id').nullable();
      table.string('action').notNullable();
      table.string('entity').notNullable();
      table.string('entity_id').nullable();
      table.json('details').nullable();
      table.timestamp('created_at').notNullable();
      table.timestamp('updated_at').notNullable();
      table.index(['company_id']);
    });
    // Access Control package storage (its published migration shape), keyed by the string ids.
    this.schema.createTable('memberships', (table) => {
      table.increments('id');
      table
        .string('scope_id', 254)
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('RESTRICT');
      table
        .string('user_id', 254)
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT');
      table.string('role', 32).notNullable();
      table.string('status', 16).notNullable().defaultTo('active');
      table.timestamp('created_at', { useTz: true }).notNullable();
      table.timestamp('updated_at', { useTz: true }).notNullable();
      table.unique(['scope_id', 'user_id']);
      table.index(['user_id']);
      table.index(['scope_id', 'created_at', 'id']);
    });
    this.schema.createTable('account_member_resources', (table) => {
      metadata(table);
      table.string('company_id').notNullable();
      table.string('user_id').notNullable();
      table.string('resource_id').notNullable();
      table.string('revision').notNullable();
      table.unique(['company_id', 'user_id']);
      table.unique(['company_id', 'resource_id']);
    });
    createMasqueradeSchema(this.schema);
    // Receipts for @kevinjohn/adonisjs-duplicate-request-guard. The two unique indexes arbitrate
    // reservations; do not drop them. The operation column holds the JSON tuple [operation name,
    // actor id], so command ids and request keys are scoped to one actor's operation.
    this.schema.createTable('request_receipts', (table) => {
      table.string('id', 36).primary();
      table
        .string('scope_id', 255)
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE');
      table.string('command_id', 255).notNullable();
      table.string('operation', 255).notNullable();
      table.string('request_key', 255).notNullable();
      table.string('payload_hash', 64).notNullable();
      table.string('state', 16).notNullable();
      table.text('result').nullable();
      table.string('created_at', 32).notNullable();
      table.string('updated_at', 32).notNullable().index();
      table.unique(['operation', 'command_id']);
      table.unique(['operation', 'request_key']);
    });
    // A group is one sign-in's server-side before-image of a typed delete; restore consumes it once.
    // Ending that sign-in deletes the group, so before-images never outlive the session.
    this.schema.createTable('deleted_groups', (table) => {
      table.string('group_id').primary();
      table
        .string('company_id')
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE');
      table.string('actor_id').notNullable();
      table
        .integer('session_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('account_sessions')
        .onDelete('CASCADE');
      table.string('mutation_id').notNullable();
      table.timestamp('created_at').notNullable();
      table.timestamp('consumed_at').nullable();
      table.index(['company_id']);
      table.index(['session_id']);
    });
    this.schema.createTable('deleted_rows', (table) => {
      table.increments('id');
      table
        .string('group_id')
        .notNullable()
        .references('group_id')
        .inTable('deleted_groups')
        .onDelete('CASCADE');
      table.string('entity').notNullable();
      table.string('row_id').notNullable();
      table.text('payload_json').notNullable();
      table.unique(['group_id', 'entity', 'row_id']);
    });
    this.schema.createTable('password_confirmations', (table) => {
      table.string('id', 36).primary();
      table
        .string('user_id', 254)
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE');
      // Account Kit's sign-in registry row; a logout or credential change deletes it and its proofs.
      table
        .integer('sign_in_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('account_sessions')
        .onDelete('CASCADE');
      table.string('credential_revision', 64).nullable();
      table.string('action', 255).notNullable();
      // A `delete-account` confirmation is scoped to the person's own id, so the scope cannot
      // reference `accounts`; confirmations last five minutes and are pruned globally.
      table.string('scope', 255).notNullable();
      table.string('intent_hash', 64).notNullable();
      // Epoch milliseconds.
      table.bigInteger('verified_at').notNullable();
      table.bigInteger('issued_at').notNullable();
      // The deadline returned at issuance; a later change to the window does not move it.
      table.bigInteger('expires_at').notNullable();
      table.bigInteger('consumed_at').nullable();
      table.index(['user_id']);
      table.index(['sign_in_id']);
      // prune(): expired by expires_at, spent by consumed_at.
      table.index(['expires_at']);
      table.index(['consumed_at']);
    });

    this.schema.createTable('company_settings', (table) => {
      scoped(table);
      table.string('key').notNullable();
      table.json('value').nullable();
      table.unique(['company_id', 'key']);
    });

    this.schema.createTable('account_getting_started_dismissals', (table) => {
      table.string('id').primary();
      table
        .string('company_id')
        .notNullable()
        .unique()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE');
      table.timestamp('created_at').notNullable();
      table.timestamp('updated_at').notNullable();
    });
    this.schema.createTable('adonis_sessions', (table) => {
      table.string('id').primary();
      table.text('data').notNullable();
      table.string('user_id').nullable().references('id').inTable('users').onDelete('CASCADE');
      table.timestamp('expires_at').notNullable();
      table.index('user_id');
      table.index('expires_at');
    });
    this.schema.createTable('password_reset_tokens', (table) => {
      table.increments('id');
      table
        .string('tokenable_id')
        .notNullable()
        .unique()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE');
      table.string('email', 254).notNullable();
      table.string('hash', 64).notNullable().unique();
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable();
    });
    this.schema.createTable('account_transaction_lock', (table) => {
      table.integer('id').primary();
      table.integer('version').notNullable().defaultTo(0);
    });
    this.defer(async (db) => {
      await db.table('account_transaction_lock').insert({ id: 1, version: 0 });
    });
    this.schema.createTable('email_verification_tokens', (table) => {
      table.increments('id');
      table
        .string('tokenable_id')
        .notNullable()
        .unique()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE');
      table.string('email', 254).notNullable();
      table.string('current_email', 254).notNullable().defaultTo('');
      table.string('purpose', 32).notNullable().defaultTo('activation');
      table.string('hash', 64).notNullable().unique();
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable();
    });
    // This table and the `social_*` tables below stay empty while their capabilities are disabled.
    // Account Kit still visits them in its hourly prune, account deletion and every credential
    // change, regardless of which capabilities are enabled.
    this.schema.createTable('login_link_tokens', (table) => {
      table.increments('id');
      table
        .string('tokenable_id')
        .notNullable()
        .unique()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE');
      table.string('email', 254).notNullable();
      table.string('hash', 64).notNullable().unique();
      table.string('client_challenge', 43).notNullable();
      table.timestamp('expires_at', { useTz: true, precision: 3 }).notNullable();
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable();
    });

    this.schema.createTable('social_identities', (table) => {
      table.increments('id');
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('provider', 64).notNullable();
      table.string('provider_user_id', 255).notNullable();
      table.string('email', 254).nullable();
      table.boolean('email_verified').notNullable().defaultTo(false);
      table.string('name', 255).nullable();
      table.string('nickname', 255).nullable();
      table.string('avatar_url', 2048).nullable();
      table.json('meta').nullable();
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable();
      table.timestamp('updated_at', { useTz: true, precision: 3 }).notNullable();
      table.timestamp('confirmed_at', { useTz: true, precision: 3 }).nullable();
      table.unique(['provider', 'provider_user_id']);
      table.index(['user_id']);
    });
    this.schema.createTable('social_transactions', (table) => {
      table.increments('id');
      table.string('hash', 64).notNullable().unique();
      table.string('provider', 64).notNullable();
      table.string('intent', 16).notNullable();
      table.string('purpose', 32).nullable();
      table.string('client_challenge', 43).notNullable();
      table.string('verification_hash', 64).nullable();
      table.string('proof_hash', 64).nullable();
      table.string('credential_revision', 40).nullable();
      table.string('user_id').nullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('provider_user_id', 255).nullable();
      table.string('email', 254).nullable();
      table.boolean('email_verified').nullable();
      table.string('name', 255).nullable();
      table.string('nickname', 255).nullable();
      table.string('avatar_url', 2048).nullable();
      table.timestamp('expires_at', { useTz: true, precision: 3 }).notNullable();
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable();
    });
    this.schema.createTable('social_sensitive_proofs', (table) => {
      table.increments('id');
      table.string('hash', 64).notNullable().unique();
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('purpose', 32).notNullable();
      table.string('credential_revision', 40).nullable();
      table.timestamp('expires_at', { useTz: true, precision: 3 }).notNullable();
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable();
      table.index(['user_id', 'purpose']);
    });
    this.schema.createTable('social_handoff_codes', (table) => {
      table.increments('id');
      table.string('hash', 64).notNullable().unique();
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table
        .integer('social_identity_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('social_identities')
        .onDelete('CASCADE');
      table.string('credential_revision', 40).nullable();
      table.string('client_challenge', 43).notNullable();
      table.timestamp('expires_at', { useTz: true, precision: 3 }).notNullable();
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable();
    });
    this.schema.createTable('account_invitations', (table) => {
      table.increments('id');
      table.string('email', 254).notNullable();
      // Account Kit scopes invitations; CapacityLens keeps every invitation in the default scope.
      table.string('scope', 255).notNullable().defaultTo('');
      table.unique(['email', 'scope']);
      table.string('role', 64).notNullable();
      table.string('inviter_id').nullable().references('id').inTable('users').onDelete('SET NULL');
      table.string('token_hash', 64).notNullable().unique();
      table.timestamp('expires_at', { useTz: true, precision: 3 }).notNullable();
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable();
      table.timestamp('updated_at', { useTz: true, precision: 3 }).notNullable();
      table.index(
        ['created_at', 'id', 'expires_at'],
        'account_invitations_created_at_id_expires_at_index'
      );
    });
    this.schema.createTable('account_admissions', (table) => {
      table.increments('id');
      // Null only on a bootstrap approval waiting for its account.
      table
        .string('user_id')
        .nullable()
        .unique()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE');
      table.string('bootstrap_email', 254).nullable().unique();
      table.timestamp('requested_at', { useTz: true, precision: 3 }).nullable();
      // The consumed account_invitations id. No foreign key: acceptance deletes that row.
      table.integer('invitation_id').nullable();
      table.string('invited_email', 254).nullable();
      table.string('invited_role', 64).nullable();
      table.string('invitation_source', 16).nullable();
      table.timestamp('invitation_recorded_at', { useTz: true, precision: 3 }).nullable();
      table.string('approval_status', 16).nullable();
      table
        .string('approval_actor_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL');
      table.timestamp('approval_decided_at', { useTz: true, precision: 3 }).nullable();
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable();
      table.timestamp('updated_at', { useTz: true, precision: 3 }).notNullable();
      table.index(['created_at', 'id'], 'account_admissions_created_at_id_index');
    });

    this.schema.createTable('company_planning_revisions', (table) => {
      table.string('company_id').primary().references('id').inTable('accounts').onDelete('CASCADE');
      table.integer('revision').notNullable().defaultTo(0);
      table.check('revision >= 0');
    });
    this.schema.createTable('planning_mutations', (table) => {
      table
        .string('company_id')
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE');
      table.string('mutation_id').notNullable();
      table.string('actor_id').notNullable();
      table.integer('revision').notNullable();
      table.primary(['company_id', 'mutation_id']);
      table.check('revision >= 0');
      table.string('restoration_group_id').nullable();
      // The sign-in that may restore; no foreign key, so the marker outlives that sign-in.
      table.integer('origin_session_id').nullable();
      table.index(['company_id', 'actor_id', 'origin_session_id', 'restoration_group_id']);
    });
    // One undo and redo history per company: the last writer's. Any other commit makes it stale,
    // so every write replaces the row in place and the table never holds more rows than companies.
    this.schema.createTable('planning_histories', (table) => {
      table.string('company_id').primary().references('id').inTable('accounts').onDelete('CASCADE');
      table
        .integer('session_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('account_sessions')
        .onDelete('CASCADE');
      table.string('actor_id').notNullable();
      // Minted by the page that owns the history, so a reload starts a new one.
      table.string('history_id').notNullable();
      table.integer('revision').notNullable();
      table.json('entries_json').notNullable();
      table.check('revision >= 0');
    });

    for (const [table, column, target] of relationships) {
      for (const operation of ['INSERT', 'UPDATE'] as const) {
        this.schema.raw(
          `CREATE TRIGGER ${table}_${column}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} WHEN NEW.${column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${target} WHERE id = NEW.${column} AND company_id = NEW.company_id) BEGIN SELECT RAISE(ABORT, 'cross-account reference'); END`
        );
      }
    }
    // SQLite runs same-timing triggers newest first. Create this check after relationship checks so
    // changing company_id always reports and enforces the immutable company boundary directly.
    for (const table of scopedTables) {
      this.schema.raw(
        `CREATE TRIGGER ${table}_account_immutable BEFORE UPDATE OF company_id ON ${table} WHEN NEW.company_id <> OLD.company_id BEGIN SELECT RAISE(ABORT, 'company_id is immutable'); END`
      );
    }
    this.schema.raw(
      "CREATE TRIGGER capacitylens_member_resource_kind_cleanup AFTER UPDATE OF kind ON resources WHEN OLD.kind = 'person' AND NEW.kind <> 'person' BEGIN DELETE FROM account_member_resources WHERE company_id = OLD.company_id AND resource_id = OLD.id; END"
    );
    // Added after the tables exist, so each table keeps its foreign-key cascade order and these
    // triggers run before the relationship triggers above.
    for (const name of retained) {
      this.schema.raw(`ALTER TABLE ${name} ADD COLUMN deleted_at TIMESTAMP`);
      this.schema.raw(
        `ALTER TABLE ${name} ADD COLUMN deletion_group_id VARCHAR REFERENCES deleted_groups(group_id) ON DELETE CASCADE`
      );
      this.schema.raw(`CREATE INDEX ${name}_deletion_group_id_index ON ${name}(deletion_group_id)`);
      for (const operation of ['INSERT', 'UPDATE'])
        this.schema.raw(
          `CREATE TRIGGER ${name}_deletion_group_${operation.toLowerCase()} BEFORE ${operation} ON ${name} WHEN NEW.deletion_group_id IS NOT NULL AND (NEW.deleted_at IS NULL OR NOT EXISTS (SELECT 1 FROM deleted_groups WHERE group_id = NEW.deletion_group_id AND company_id = NEW.company_id)) BEGIN SELECT RAISE(ABORT, 'invalid deletion group association'); END`
        );
    }
    this.schema.raw(
      `CREATE TRIGGER deleted_groups_active_row_guard BEFORE DELETE ON deleted_groups WHEN ${retained.map((name) => `EXISTS (SELECT 1 FROM ${name} WHERE deletion_group_id = OLD.group_id AND deleted_at IS NULL)`).join(' OR ')} BEGIN SELECT RAISE(ABORT, 'active row cannot belong to deletion group'); END`
    );
    this.schema.raw(
      "CREATE TRIGGER deleted_groups_account_immutable BEFORE UPDATE OF company_id ON deleted_groups WHEN NEW.company_id <> OLD.company_id BEGIN SELECT RAISE(ABORT, 'company_id is immutable'); END"
    );
  }
}
