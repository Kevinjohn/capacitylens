import { inject } from '@adonisjs/core';
import type { CommandOptions } from '@adonisjs/core/types/ace';
import { SchemaIntegrityService } from '#services/schema_integrity_service';
import { OperatorCommand } from './_operator_command.js';

/** Run the package's backup-then-migrate command, then check the migrated schema. */
export default class AppUpgrade extends OperatorCommand {
  static commandName = 'app:upgrade';
  static description = 'Back up the SQLite database, then run pending migrations';
  static options: CommandOptions = { startApp: true };

  @inject()
  async run(schemaIntegrity: SchemaIntegrityService) {
    const upgrade = await this.kernel.exec('db:upgrade', ['--no-schema-generate']);
    if (upgrade.exitCode !== 0) {
      this.error = upgrade.error;
      this.exitCode = upgrade.exitCode ?? 1;
      return;
    }
    await schemaIntegrity.assertSchemaIntegrity();
  }

  protected buildFailureMessage(error: unknown) {
    return `Upgrade failed: ${String(error)}`;
  }
}
