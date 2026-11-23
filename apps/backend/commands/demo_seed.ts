import type { CommandOptions } from '@adonisjs/core/types/ace';
import { assertDisposableDemoDatabase, seedDisposableDemo } from '#services/disposable_demo';
import { OperatorCommand } from './_operator_command.js';

export default class DemoSeed extends OperatorCommand {
  static commandName = 'capacitylens:demo:seed';
  static description = 'Seed the disposable development demo installation';
  static options: CommandOptions = { startApp: true };

  async run() {
    assertDisposableDemoDatabase(this.app);
    await seedDisposableDemo(this.app);
  }

  protected buildFailureMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Disposable demo preparation failed';
  }
}
