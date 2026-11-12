import { BaseCommand } from '@adonisjs/core/ace';
import type { CommandOptions } from '@adonisjs/core/types/ace';
import { assertDisposableDemoDatabase, seedDisposableDemo } from '#services/disposable_demo';

export default class DemoCommand extends BaseCommand {
  static commandName = 'capacitylens:demo:seed';
  static description = 'Prepare the disposable development demo installation';
  static options: CommandOptions = { startApp: true };
  async run() {
    try {
      assertDisposableDemoDatabase(this.app);
      await seedDisposableDemo(this.app);
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error.message : 'Disposable demo preparation failed'
      );
      this.exitCode = 1;
    }
  }
}
