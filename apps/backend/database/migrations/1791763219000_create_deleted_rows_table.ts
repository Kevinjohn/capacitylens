import { BaseSchema } from '@adonisjs/lucid/schema';

export default class extends BaseSchema {
  protected tableName = 'deleted_rows';

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id');
      table
        .string('group_id')
        .notNullable()
        .references('group_id')
        .inTable('deleted_groups')
        .onDelete('CASCADE');
      table.string('entity').notNullable();
      table.string('row_id').notNullable();
      table.text('payload_json').notNullable();
      table.unique(['group_id', 'entity', 'row_id']);
    });
  }

  async down() {
    this.schema.dropTable(this.tableName);
  }
}
