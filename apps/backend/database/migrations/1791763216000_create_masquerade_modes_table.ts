import { BaseSchema } from '@adonisjs/lucid/schema'
import {
  createMasqueradeSchema,
  dropMasqueradeSchema,
} from '@kevinjohn/adonisjs-masquerade/stores/lucid'

/** The masquerade package's tables: `masquerade_modes` and `masquerade_events`. */
export default class extends BaseSchema {
  protected tableName = 'masquerade_modes'

  async up() {
    createMasqueradeSchema(this.schema)
  }

  async down() {
    dropMasqueradeSchema(this.schema)
  }
}
