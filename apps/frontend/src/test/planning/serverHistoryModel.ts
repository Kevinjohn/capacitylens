import type { PlanningHistory } from '@/data/planning/planningCacheTypes'

/**
 * The server's one history row per company, reduced to counts for cache tests: the last
 * writer's page id, the revision it holds and how many steps it has each way. A change under another
 * id or with none, or any revision the row does not hold, leaves the reading page with no history.
 */
export function createServerHistoryModel() {
  let row: { historyId: string; revision: number; past: number; future: number } | null = null
  const live = (historyId: string | null | undefined, revision: number) =>
    row && row.historyId === historyId && row.revision === revision ? row : null
  return {
    /** Whether the page with `historyId` holds the history at `revision`. */
    isLive(historyId: string | null | undefined, revision: number): boolean {
      return live(historyId, revision) !== null
    },
    /** What a read at `revision` by the page with `historyId` is told. */
    report(historyId: string | null | undefined, revision: number): PlanningHistory {
      const current = live(historyId, revision)
      return { canUndo: (current?.past ?? 0) > 0, canRedo: (current?.future ?? 0) > 0 }
    },
    /** Records a committed new change from `previousRevision` to `revision`. */
    committed(historyId: string | null | undefined, previousRevision: number, revision: number) {
      const current = live(historyId, previousRevision)
      row =
        typeof historyId === 'string'
          ? { historyId, revision, past: (current?.past ?? 0) + 1, future: 0 }
          : null
    },
    /** Takes one step, or throws the server's bare 409 when that direction is empty. */
    step(kind: 'undo' | 'redo', historyId: string, revision: number, nextRevision: number) {
      const current = live(historyId, revision)
      const from = kind === 'undo' ? 'past' : 'future'
      if (!current || current[from] === 0) {
        throw Object.assign(new Error(`There is nothing to ${kind}.`), { status: 409 })
      }
      current[from] -= 1
      current[kind === 'undo' ? 'future' : 'past'] += 1
      current.revision = nextRevision
    },
    /** Ends the history, as the server does after refusing one of its steps. */
    end() {
      row = null
    },
  }
}
