import type { ApplicationService } from '@adonisjs/core/types';
import db from '@adonisjs/lucid/services/db';
import { pruneReceipts } from '@kevinjohn/adonisjs-duplicate-request-guard';

/** Completed request receipts are kept this long; a client retries a command within seconds. */
export const REQUEST_RECEIPT_RETENTION_MS = 24 * 60 * 60_000;

/**
 * Deletes completed request receipts older than the retention window. Pending receipts stay.
 * @returns the number of receipts deleted.
 */
export function pruneRequestReceipts(now = new Date()): Promise<number> {
  return pruneReceipts(db.connection(), {
    olderThan: new Date(now.getTime() - REQUEST_RECEIPT_RETENTION_MS),
  });
}

/**
 * Runs one pass of the Masquerade package's own `masquerade:prune` command: expired view-as modes
 * end and events older than the configured retention are deleted.
 * @throws the command's error when the pass fails.
 */
export async function pruneViewAs(app: ApplicationService): Promise<void> {
  const ace = await app.container.make('ace');
  const command = await ace.exec('masquerade:prune', []);
  if (command.exitCode) throw command.error ?? new Error('masquerade:prune failed');
}
