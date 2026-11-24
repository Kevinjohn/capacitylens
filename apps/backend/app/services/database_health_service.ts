import { inject } from '@adonisjs/core';
import db from '@adonisjs/lucid/services/db';
import { SchemaIntegrityService } from '#services/schema_integrity_service';

/** The database's answer and schema, checked together. */
@inject()
export class DatabaseHealthService {
  #schemaIntegrity: SchemaIntegrityService;

  constructor(schemaIntegrity: SchemaIntegrityService) {
    this.#schemaIntegrity = schemaIntegrity;
  }

  /** Confirms the database answers and has recorded every migration this release ships. */
  async checkDatabase() {
    await db.rawQuery('select 1');
    await this.#schemaIntegrity.assertSchemaIntegrity();
  }
}
