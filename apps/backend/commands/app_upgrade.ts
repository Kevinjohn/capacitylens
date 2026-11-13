import { BaseCommand } from '@adonisjs/core/ace';
import type { CommandOptions } from '@adonisjs/core/types/ace';
import { assertSchemaIntegrity } from '#services/schema_integrity';

/** Run the package's backup-then-migrate command, then check the migrated schema. */
export default class AppUpgrade extends BaseCommand {
  static commandName = 'app:upgrade';
  static description = 'Back up the SQLite database, then run pending migrations';
  static options: CommandOptions = { startApp: true };

  async run() {
    const upgrade = await this.kernel.exec('db:upgrade', ['--no-schema-generate']);
    if (upgrade.exitCode !== 0) {
      this.error = upgrade.error;
      this.exitCode = upgrade.exitCode ?? 1;
      return;
    }
    try {
      await assertSchemaIntegrity();
    } catch (error) {
      this.logger.error(`Upgrade failed: ${String(error)}`);
      this.exitCode = 1;
    }
  }
}
