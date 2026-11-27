import { BaseSchema } from '@adonisjs/lucid/schema';
import { guardCompany, scoped } from '#database/migration_helpers';

export default class extends BaseSchema {
  protected tableName = 'clients';

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      scoped(table);
      table.string('name').notNullable();
      table.string('color').notNullable();
      table.boolean('is_private').nullable();
      table.string('code_name').nullable();
      table.boolean('builtin').nullable();
      table.timestamp('archived_at').nullable();
      table.check('is_private IS NULL OR is_private IN (0, 1)');
      table.check('builtin IS NULL OR builtin IN (0, 1)');
    });
    guardCompany(this.schema, this.tableName);
  }

  async down() {
    this.schema.dropTable(this.tableName);
  }
}
