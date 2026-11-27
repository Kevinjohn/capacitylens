import { BaseSchema } from '@adonisjs/lucid/schema';

/**
 * Access Control package storage (its published migration shape), keyed by the string ids.
 */
export default class extends BaseSchema {
  protected tableName = 'memberships';

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id');
      table
        .string('scope_id', 254)
        .notNullable()
        .references('id')
        .inTable('companies')
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
  }

  async down() {
    this.schema.dropTable(this.tableName);
  }
}
