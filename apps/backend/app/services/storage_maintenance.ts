import { Kernel } from '@adonisjs/core/ace';
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
 * end and events older than the configured retention are deleted. The command runs on a kernel
 * holding only that package's commands, so a pass does not load every application command.
 * @throws the command's error when the pass fails.
 */
export async function pruneViewAs(app: ApplicationService): Promise<void> {
  const kernel = new Kernel(app);
  kernel.addLoader(() => import('@kevinjohn/adonisjs-masquerade/commands'));
  const command = await kernel.exec('masquerade:prune', []);
  if (command.exitCode) throw command.error ?? new Error('masquerade:prune failed');
}

/** One named maintenance task; `report` receives its failure. */
export type MaintenanceTask = readonly [name: string, run: () => Promise<unknown>];

/**
 * Runs maintenance tasks one after another. A failing task is reported and the next still runs.
 * After `stop` no further task starts, and `stop` resolves once the task in flight has ended, so
 * shutdown can close the database knowing no maintenance query follows.
 */
export function createMaintenance(
  tasks: readonly MaintenanceTask[],
  report: (task: string, error: unknown) => void
) {
  let stopping = false;
  let running: Promise<void> = Promise.resolve();
  const pass = async () => {
    for (const [name, run] of tasks) {
      if (stopping) return;
      await run().catch((error: unknown) => report(name, error));
    }
  };
  return {
    /** Starts one pass after any pass still in flight. */
    run(): Promise<void> {
      running = running.then(pass);
      return running;
    },
    async stop(): Promise<void> {
      stopping = true;
      await running;
    },
  };
}
