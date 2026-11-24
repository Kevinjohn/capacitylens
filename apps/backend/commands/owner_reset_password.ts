import { inject } from '@adonisjs/core';
import { args, flags } from '@adonisjs/core/ace';
import type { CommandOptions } from '@adonisjs/core/types/ace';
import { OwnerRecoveryService } from '#services/operator/owner_recovery_service';
import { OperatorCommand } from './_operator_command.js';

/** Recover a sole owner using an audited single-use link while the server is stopped. */
export default class OwnerResetPassword extends OperatorCommand {
  static commandName = 'owner:reset-password';
  static description = 'Issue an audited single-use recovery link for a sole active Owner';
  static options: CommandOptions = { startApp: true };
  @args.string({ description: 'Owner email address' }) declare email: string;
  @flags.boolean({ description: 'Confirm that the application server is stopped' })
  declare confirmServerStopped: boolean;

  @inject()
  async run(ownerRecovery: OwnerRecoveryService) {
    const result = await ownerRecovery.recover(this);
    this.logger.log(JSON.stringify(result));
  }

  protected buildFailureMessage(error: unknown) {
    // Database and package errors may contain credential material; report a bounded cause.
    const message = error instanceof Error ? error.message : '';
    return /^(Refusing|Operator commands|Another process|Recovery requires|The target|CAPACITYLENS_)/.test(
      message
    )
      ? message
      : /^Database /.test(message)
        ? 'Database schema is not current'
        : 'Owner recovery failed; no recovery link was delivered';
  }
}
