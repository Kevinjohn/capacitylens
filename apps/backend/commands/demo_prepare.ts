import type { CommandOptions } from '@adonisjs/core/types/ace';
import { assertDisposableDemoDatabase, prepareDisposableDemo } from '#services/disposable_demo';
import { OperatorCommand } from './_operator_command.js';

export default class DemoPrepare extends OperatorCommand {
  static commandName = 'capacitylens:demo:prepare';
  static description = 'Prepare the disposable development demo installation';
  static options: CommandOptions = { startApp: true };

  async run() {
    assertDisposableDemoDatabase(this.app);
    await prepareDisposableDemo(this.app);
  }

  protected buildFailureMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Disposable demo preparation failed';
  }
}
