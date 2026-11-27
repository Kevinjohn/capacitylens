import { BaseSchema } from '@adonisjs/lucid/schema';

export default class extends BaseSchema {
  protected tableName = 'company_getting_started_dismissals';

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary();
      table
        .string('company_id')
        .notNullable()
        .unique()
        .references('id')
        .inTable('companies')
        .onDelete('CASCADE');
      table.timestamp('created_at').notNullable();
      table.timestamp('updated_at').notNullable();
    });
  }

  async down() {
    this.schema.dropTable(this.tableName);
  }
}
