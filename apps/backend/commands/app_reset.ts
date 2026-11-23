import { args, flags } from '@adonisjs/core/ace';
import type { CommandOptions } from '@adonisjs/core/types/ace';
import { resetInstallation } from '#services/operator/reset_installation';
import { OperatorCommand } from './_operator_command.js';

/** Preserve the stopped installation before creating an empty replacement. */
export default class AppReset extends OperatorCommand {
  static commandName = 'app:reset';
  static description =
    'Back up and archive the stopped installation, then initialize a new database path';
  static options: CommandOptions = { startApp: true };
  @args.string({ description: 'New, unused database path' }) declare newDatabasePath: string;
  @flags.boolean({ description: 'Confirm that the application server is stopped' })
  declare confirmServerStopped: boolean;

  @flags.boolean({ description: 'Confirm this is a disposable non-production installation' })
  declare disposable: boolean;

  async run() {
    this.logger.log(JSON.stringify(await resetInstallation(this)));
  }

  protected buildFailureMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Installation reset failed';
  }
}
