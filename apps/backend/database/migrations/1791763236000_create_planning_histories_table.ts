import { BaseSchema } from '@adonisjs/lucid/schema';

/**
 * One undo and redo history per company: the last writer's. Any other commit makes it stale,
 * so every write replaces the row in place and the table never holds more rows than companies.
 */
export default class extends BaseSchema {
  protected tableName = 'planning_histories';

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table
        .string('company_id')
        .primary()
        .references('id')
        .inTable('companies')
        .onDelete('CASCADE');
      table
        .integer('session_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('account_sessions')
        .onDelete('CASCADE');
      table.string('actor_id').notNullable();
      // Minted by the page that owns the history, so a reload starts a new one.
      table.string('history_id').notNullable();
      table.integer('revision').notNullable();
      table.json('entries_json').notNullable();
      table.check('revision >= 0');
    });
  }

  async down() {
    this.schema.dropTable(this.tableName);
  }
}
