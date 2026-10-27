import { BaseSchema } from '@adonisjs/lucid/schema'
import { createMasqueradeSchema } from 'adonisjs-masquerade/stores/lucid'

/** Replace session-scoped temporary controls with the package's identity-scoped control store. */
export default class extends BaseSchema {
  async up() {
    createMasqueradeSchema(this.schema)
    this.schema.dropTable('masquerades')
  }
}
