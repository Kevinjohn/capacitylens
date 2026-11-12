import { BaseSchema } from '@adonisjs/lucid/schema';

/**
 * A `delete-account` confirmation is scoped to the person's own id, so the scope cannot reference
 * `accounts`; confirmations last five minutes and are pruned globally.
 */
export default class extends BaseSchema {
  protected tableName = 'password_confirmations';

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropForeign(['scope']);
    });
  }
}
