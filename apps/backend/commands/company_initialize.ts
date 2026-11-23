import { args, flags } from '@adonisjs/core/ace';
import type { CommandOptions } from '@adonisjs/core/types/ace';
import { initializeCompany } from '#services/operator/company_initialization';
import { OperatorCommand } from './_operator_command.js';

/** Initialise company access for an existing identity on an empty stopped installation. */
export default class CompanyInitialize extends OperatorCommand {
  static commandName = 'company:initialize';
  static description = 'Initialize the first company and Owner for an existing identity';
  static options: CommandOptions = { startApp: true };
  @args.string({ description: 'Existing Owner email address' }) declare email: string;
  @args.string({ description: 'Company name' }) declare companyName: string;
  @flags.boolean({ description: 'Confirm that the application server is stopped' })
  declare confirmServerStopped: boolean;

  async run() {
    this.logger.log(JSON.stringify(await initializeCompany(this)));
  }

  protected buildFailureMessage(error: unknown) {
    const message = error instanceof Error ? error.message : '';
    return /^(Refusing|Operator commands|Another process)/.test(message)
      ? message
      : /^Database /.test(message)
        ? 'Database schema is not current'
        : 'Company initialization failed; no company access was created';
  }
}
