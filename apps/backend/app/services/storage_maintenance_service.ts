import ace from '@adonisjs/core/services/ace'
import db from '@adonisjs/lucid/services/db'
import { pruneReceipts } from '@kevinjohn/adonisjs-duplicate-request-guard'

/** Completed request receipts are kept this long; a client retries an operation within seconds. */
export const REQUEST_RECEIPT_RETENTION_MS = 24 * 60 * 60_000

/**
 * Committed planning-mutation markers are kept this long, so a reused mutation id is refused for
 * at least this window. A marker whose restoration group is still pending stays regardless.
 */
export const PLANNING_MUTATION_RETENTION_MS = 30 * 24 * 60 * 60_000

/** Audit entries are kept this long, the same window as view-as events. */
export const AUDIT_ENTRY_RETENTION_MS = 365 * 24 * 60 * 60_000

/** One named maintenance task; `report` receives its failure. */
export type MaintenanceTask = readonly [name: string, run: () => Promise<unknown>]

/**
 * Background upkeep: receipt, planning-mutation, audit and view-as pruning, and the task runner
 * that schedules them.
 */
export class StorageMaintenanceService {
  /**
   * Deletes completed request receipts older than the retention window. Pending receipts stay.
   * @returns the number of receipts deleted.
   */
  pruneRequestReceipts(now = new Date()): Promise<number> {
    return pruneReceipts(db.connection(), {
      olderThan: new Date(now.getTime() - REQUEST_RECEIPT_RETENTION_MS),
    })
  }

  /**
   * Deletes committed planning-mutation markers older than the retention window. A marker whose
   * restoration group is still pending stays while that group can still be restored.
   * @returns the number of markers deleted.
   */
  async prunePlanningMutations(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - PLANNING_MUTATION_RETENTION_MS).toISOString()
    // Restoration bookkeeping, not a product row.
    return Number(
      await db
        .from('planning_mutations')
        .where('created_at', '<', cutoff)
        .whereNotExists((pending) =>
          pending
            .from('deleted_batches')
            .whereColumn('deleted_batches.id', 'planning_mutations.restoration_group_id')
            .whereNull('deleted_batches.consumed_at')
        )
        .delete()
    )
  }

  /**
   * Deletes audit entries older than the retention window.
   * @returns the number of entries deleted.
   */
  async pruneAuditEntries(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - AUDIT_ENTRY_RETENTION_MS).toISOString()
    return Number(await db.from('audit_entries').where('created_at', '<', cutoff).delete())
  }

  /**
   * Runs one pass of the Masquerade package's own `masquerade:prune` command: expired view-as modes
   * end and events older than the configured retention are deleted.
   * @throws the command's error when the pass fails.
   */
  async pruneExpiredMasquerades(): Promise<void> {
    const command = await ace.exec('masquerade:prune', [])
    if (command.exitCode) throw command.error ?? new Error('masquerade:prune failed')
  }

  /**
   * Runs maintenance tasks one after another. A failing task is reported and the next still runs.
   * After `stop` no further task starts, and `stop` resolves once the task in flight has ended, so
   * shutdown can close the database knowing no maintenance query follows.
   */
  createMaintenance(
    tasks: readonly MaintenanceTask[],
    report: (task: string, error: unknown) => void
  ) {
    let stopping = false
    let running: Promise<void> = Promise.resolve()
    const pass = async () => {
      for (const [name, run] of tasks) {
        if (stopping) return
        await run().catch((error: unknown) => report(name, error))
      }
    }
    return {
      /** Starts one pass after any pass still in flight. */
      run(): Promise<void> {
        running = running.then(pass)
        return running
      },
      async stop(): Promise<void> {
        stopping = true
        await running
      },
    }
  }
}
