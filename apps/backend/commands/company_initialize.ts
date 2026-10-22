import { args, BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { initializeCompany } from '#services/operations/company_initialization'

/** Initialize company access for an existing identity on an empty stopped installation. */
export default class CompanyInitialize extends BaseCommand {
  static commandName = 'company:initialize'
  static description = 'Initialize the first company and Owner for an existing identity'
  static options: CommandOptions = { startApp: true }
  @args.string({ description: 'Existing Owner email address' }) declare email: string
  @args.string({ description: 'Company name' }) declare companyName: string
  @flags.boolean({ description: 'Confirm that the application server is stopped' })
  declare confirmServerStopped: boolean

  async run() {
    try {
      this.logger.log(JSON.stringify(await initializeCompany(this)))
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      const safe = /^(Refusing|Operator commands|Another process)/.test(message)
        ? message
        : /^Database /.test(message)
          ? 'Database schema is not current'
          : 'Company initialization failed; no company access was created'
      this.logger.error(safe)
      this.exitCode = 1
    }
  }
}
