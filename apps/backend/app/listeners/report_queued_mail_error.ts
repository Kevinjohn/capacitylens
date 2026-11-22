import type { EventsList } from '@adonisjs/core/types';
import logger from '@adonisjs/core/services/logger';

/**
 * Queued mail is sent after the request answers, so a transport failure is only visible here; the
 * log carries the error name, never the message, which can hold an address or link.
 */
export default class ReportQueuedMailError {
  async handle({ error, mailerName }: EventsList['queued:mail:error']) {
    logger.error(
      { mailer: mailerName, errorName: error instanceof Error ? error.name : 'unknown' },
      'Queued mail delivery failed'
    );
  }
}
