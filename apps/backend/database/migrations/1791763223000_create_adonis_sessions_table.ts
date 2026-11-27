import { BaseSchema } from '@adonisjs/lucid/schema';

export default class extends BaseSchema {
  protected tableName = 'adonis_sessions';

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary();
      table.text('data').notNullable();
      table.string('user_id').nullable().references('id').inTable('users').onDelete('CASCADE');
      table.timestamp('expires_at').notNullable();
      table.index('user_id');
      table.index('expires_at');
    });
  }

  async down() {
    this.schema.dropTable(this.tableName);
  }
}
