import { args, BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { recoverOwner } from '#services/operations/owner_recovery'

/** Recover a sole owner using an audited single-use link while the server is stopped. */
export default class OwnerResetPassword extends BaseCommand {
  static commandName = 'owner:reset-password'
  static description = 'Issue an audited single-use recovery link for a sole active Owner'
  static options: CommandOptions = { startApp: true }
  @args.string({ description: 'Owner email address' }) declare email: string
  @flags.boolean({ description: 'Confirm that the application server is stopped' })
  declare confirmServerStopped: boolean

  async run() {
    try {
      const result = await recoverOwner(this)
      this.logger.log(JSON.stringify(result))
    } catch (error) {
      // Database and package errors may contain credential material; report a bounded cause.
      const message = error instanceof Error ? error.message : ''
      const safe =
        /^(Refusing|Operator commands|Another process|Recovery requires|The target|CAPACITYLENS_)/.test(
          message
        )
          ? message
          : /^Database /.test(message)
            ? 'Database schema is not current'
            : 'Owner recovery failed; no recovery link was delivered'
      this.logger.error(safe)
      this.exitCode = 1
    }
  }
}
