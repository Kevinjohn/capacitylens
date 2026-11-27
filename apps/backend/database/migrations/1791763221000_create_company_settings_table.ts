import { BaseSchema } from '@adonisjs/lucid/schema';
import { scoped } from '#database/migration_helpers';

export default class extends BaseSchema {
  protected tableName = 'company_settings';

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      scoped(table);
      table.string('key').notNullable();
      table.json('value').nullable();
      table.unique(['company_id', 'key']);
    });
  }

  async down() {
    this.schema.dropTable(this.tableName);
  }
}
