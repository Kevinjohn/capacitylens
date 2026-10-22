import { args, BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { resetInstallation } from '#services/operations/reset_installation'

/** Preserve the stopped installation before creating an empty replacement. */
export default class AppReset extends BaseCommand {
  static commandName = 'app:reset'
  static description =
    'Snapshot and archive the stopped installation, then initialize a new database path'
  static options: CommandOptions = { startApp: true }
  @args.string({ description: 'New, unused database path' }) declare newDatabasePath: string
  @flags.boolean({ description: 'Confirm that the application server is stopped' })
  declare confirmServerStopped: boolean

  @flags.boolean({ description: 'Confirm this is a disposable non-production installation' })
  declare disposable: boolean

  async run() {
    try {
      this.logger.log(JSON.stringify(await resetInstallation(this)))
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : 'Installation reset failed')
      this.exitCode = 1
    }
  }
}
