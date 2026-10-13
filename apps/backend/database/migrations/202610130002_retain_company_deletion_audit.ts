import { BaseSchema } from '@adonisjs/lucid/schema'

const columns =
  'id, account_id, actor_id, action, entity, entity_id, details, created_at, updated_at'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('audit_entries_rebuilt', (table) => {
      table.string('id').primary()
      table.string('account_id').notNullable()
      table.string('actor_id').nullable()
      table.string('action').notNullable()
      table.string('entity').notNullable()
      table.string('entity_id').nullable()
      table.json('details').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
    this.schema.raw(
      `INSERT INTO audit_entries_rebuilt (${columns}) SELECT ${columns} FROM audit_entries`
    )
    this.schema.dropTable('audit_entries')
    this.schema.renameTable('audit_entries_rebuilt', 'audit_entries')
    this.schema.alterTable('audit_entries', (table) => table.index(['account_id']))
  }

  async down() {
    const historical = await this.db
      .from('audit_entries as audit')
      .leftJoin('accounts as account', 'account.id', 'audit.account_id')
      .whereNull('account.id')
      .select('audit.account_id')
      .first()
    if (historical)
      throw new Error(
        'Cannot restore audit account foreign key while deleted-company audit history remains.'
      )
    this.schema.createTable('audit_entries_rebuilt', (table) => {
      table.string('id').primary()
      table
        .string('account_id')
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
      table.string('actor_id').nullable()
      table.string('action').notNullable()
      table.string('entity').notNullable()
      table.string('entity_id').nullable()
      table.json('details').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
    this.schema.raw(
      `INSERT INTO audit_entries_rebuilt (${columns}) SELECT ${columns} FROM audit_entries`
    )
    this.schema.dropTable('audit_entries')
    this.schema.renameTable('audit_entries_rebuilt', 'audit_entries')
    this.schema.alterTable('audit_entries', (table) => table.index(['account_id']))
  }
}
