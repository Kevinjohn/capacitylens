import { BaseCommand } from '@adonisjs/core/ace'

/**
 * An operator command that reports a failed run as one safe line. Its `run()` lets an error
 * propagate: Ace records it in `this.error` with exit code 1, and `completed()` logs the safe line
 * and returns true so Ace does not print the raw error. The `_` prefix keeps the Ace loader from
 * reading this file as a command.
 */
export default abstract class OperatorCommand extends BaseCommand {
  /** The one line an operator sees for a failed run. It must carry no credential material. */
  protected abstract buildFailureMessage(error: unknown): string

  async completed() {
    if (!this.error) return false
    this.logger.error(this.buildFailureMessage(this.error))
    return true
  }
}
