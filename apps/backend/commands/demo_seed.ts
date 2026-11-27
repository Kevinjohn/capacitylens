import type { CommandOptions } from '@adonisjs/core/types/ace'
import { inject } from '@adonisjs/core'
import OperatorCommand from '#commands/_operator_command'
import { DisposableDemoService } from '#services/disposable_demo_service'

export default class DemoSeed extends OperatorCommand {
  static commandName = 'demo:seed'
  static description = 'Seed the disposable development demo installation'
  static options: CommandOptions = { startApp: true }

  @inject()
  async run(disposableDemo: DisposableDemoService) {
    disposableDemo.assertDisposableDemoDatabase(this.app)
    await disposableDemo.seedDisposableDemo(this.app)
  }

  protected buildFailureMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Disposable demo preparation failed'
  }
}
