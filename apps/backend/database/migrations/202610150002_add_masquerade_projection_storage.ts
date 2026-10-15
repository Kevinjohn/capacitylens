import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('masquerades', (table) => {
      table
        .string('target_user_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('token').nullable()
      table.timestamp('started_at').nullable()
    })
  }

  async down() {
    this.schema.alterTable('masquerades', (table) => {
      table.dropColumn('target_user_id')
      table.dropColumn('token')
      table.dropColumn('started_at')
    })
  }
}
