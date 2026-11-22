import { args, BaseCommand, flags } from '@adonisjs/core/ace';
import type { CommandOptions } from '@adonisjs/core/types/ace';
import { resetInstallation } from '#services/operator/reset_installation';

/** Preserve the stopped installation before creating an empty replacement. */
export default class AppReset extends BaseCommand {
  static commandName = 'app:reset';
  static description =
    'Back up and archive the stopped installation, then initialize a new database path';
  static options: CommandOptions = { startApp: true };
  @args.string({ description: 'New, unused database path' }) declare newDatabasePath: string;
  @flags.boolean({ description: 'Confirm that the application server is stopped' })
  declare confirmServerStopped: boolean;

  @flags.boolean({ description: 'Confirm this is a disposable non-production installation' })
  declare disposable: boolean;

  #reported = false;

  async run() {
    try {
      this.logger.log(JSON.stringify(await resetInstallation(this)));
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : 'Installation reset failed');
      this.error = error;
      this.#reported = true;
      this.exitCode = 1;
    }
  }

  /** Marks a caught error as already reported, so Ace does not print it raw. */
  async completed() {
    return this.#reported;
  }
}
