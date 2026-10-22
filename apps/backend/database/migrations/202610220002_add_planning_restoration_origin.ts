import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('planning_mutations', (table) => {
      table.string('restoration_group_id').nullable()
      table.string('origin_session_id').nullable()
      table.index(['account_id', 'actor_id', 'origin_session_id', 'restoration_group_id'])
    })
  }

  async down() {
    this.schema.alterTable('planning_mutations', (table) => {
      table.dropIndex(['account_id', 'actor_id', 'origin_session_id', 'restoration_group_id'])
      table.dropColumn('restoration_group_id')
      table.dropColumn('origin_session_id')
    })
  }
}
