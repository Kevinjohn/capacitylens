import { BaseSchema } from '@adonisjs/lucid/schema';
import { metadata } from '#database/migration_helpers';

/**
 * Account Kit's Lucid adapter maps these columns; password is the AdonisJS hasher's output.
 */
export default class extends BaseSchema {
  protected tableName = 'users';

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      metadata(table);
      table.string('email', 254).notNullable().unique();
      table.string('display_name').nullable();
      table.string('password').nullable();
      table.timestamp('email_verified_at', { useTz: true, precision: 3 }).nullable();
      table.string('unverified_email', 254).nullable();
      // Milliseconds: two credential changes within one second must give different revisions.
      table.timestamp('credentials_changed_at', { useTz: true, precision: 3 }).nullable();
    });
  }

  async down() {
    this.schema.dropTable(this.tableName);
  }
}
