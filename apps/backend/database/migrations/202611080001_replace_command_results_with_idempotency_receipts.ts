import { BaseSchema } from '@adonisjs/lucid/schema';

/**
 * Receipts for @kevinjohn/adonisjs-idempotency. The two unique indexes arbitrate reservations;
 * do not drop them. The operation column holds the JSON tuple [operation name, actor id], so command ids and
 * idempotency keys are scoped to one actor's operation.
 */
export default class extends BaseSchema {
  protected tableName = 'idempotency_receipts';

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id', 36).primary();
      table
        .string('scope_id', 255)
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE');
      table.string('command_id', 255).notNullable();
      table.string('operation', 255).notNullable();
      table.string('idempotency_key', 255).notNullable();
      table.string('payload_hash', 64).notNullable();
      table.string('state', 16).notNullable();
      table.text('result').nullable();
      table.string('created_at', 32).notNullable();
      table.string('updated_at', 32).notNullable().index();
      table.unique(['operation', 'command_id']);
      table.unique(['operation', 'idempotency_key']);
    });
    this.schema.dropTable('command_results');
  }
}
