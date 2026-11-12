import { BaseSchema } from '@adonisjs/lucid/schema';

/** Ownership transfer is one atomic transaction, so the staged-ceremony table holds nothing. */
export default class extends BaseSchema {
  async up() {
    this.schema.dropTable('ownership_transfers');
  }
}
