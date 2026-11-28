import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'deleted_rows'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .string('deleted_batch_id')
        .notNullable()
        .references('id')
        .inTable('deleted_batches')
        .onDelete('CASCADE')
      table.string('entity').notNullable()
      table.string('row_id').notNullable()
      table.text('payload_json').notNullable()
      table.unique(['deleted_batch_id', 'entity', 'row_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
