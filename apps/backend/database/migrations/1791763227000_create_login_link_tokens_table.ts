import { BaseSchema } from '@adonisjs/lucid/schema';

/**
 * This table and the `social_*` tables stay empty while their capabilities are disabled.
 * Account Kit still visits them in its hourly prune, account deletion and every credential
 * change, regardless of which capabilities are enabled.
 */
export default class extends BaseSchema {
  protected tableName = 'login_link_tokens';

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
      table.string('hash', 64).notNullable().unique();
      table.string('client_challenge', 43).notNullable();
      table.timestamp('expires_at', { useTz: true, precision: 3 }).notNullable();
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable();
    });
  }

  async down() {
    this.schema.dropTable(this.tableName);
  }
}
