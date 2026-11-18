import { BaseSchema } from '@adonisjs/lucid/schema';

/**
 * One undo and redo history per company: the last writer's. Any other commit makes it stale, so
 * every write replaces the row in place and the table never holds more rows than companies.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('planning_histories', (table) => {
      table.string('company_id').primary().references('id').inTable('accounts').onDelete('CASCADE');
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
}
