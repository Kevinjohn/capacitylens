import { BaseCommand } from '@adonisjs/core/ace';
import type { CommandOptions } from '@adonisjs/core/types/ace';
import { assertDisposableDemoDatabase, prepareDisposableDemo } from '#services/disposable_demo';

export default class DemoPrepare extends BaseCommand {
  static commandName = 'capacitylens:demo:prepare';
  static description = 'Prepare the disposable development demo installation';
  static options: CommandOptions = { startApp: true };
  #reported = false;

  async run() {
    try {
      assertDisposableDemoDatabase(this.app);
      await prepareDisposableDemo(this.app);
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error.message : 'Disposable demo preparation failed'
      );
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
