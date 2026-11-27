import { BaseSchema } from '@adonisjs/lucid/schema';

export default class extends BaseSchema {
  protected tableName = 'email_verification_tokens';

  async up() {
    this.schema.createTable(this.tableName, (table) => {
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
  }

  async down() {
    this.schema.dropTable(this.tableName);
  }
}
