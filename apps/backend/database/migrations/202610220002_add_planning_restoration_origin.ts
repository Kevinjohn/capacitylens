import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('planning_mutations', (table) => {
      table.string('restoration_group_id').nullable()
      table.string('origin_session_id').nullable()
      table.index(['account_id', 'actor_id', 'origin_session_id', 'restoration_group_id'])
    })
  }
}
