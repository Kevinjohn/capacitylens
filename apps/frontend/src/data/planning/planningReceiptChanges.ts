import type { AppData, AppDataKey } from '@capacitylens/shared/types/entities'
import type { PlanningMutationSuccess } from '@/api/planningContracts'

export type PlanningReceiptChanges = PlanningMutationSuccess['changes']

/**
 * The rows after a committed write: each upsert replaces the row with its id, or is appended, and
 * each removed id disappears. Entities the write did not touch keep their array identity. Apply
 * only to rows held at the receipt's `revision - 1`.
 */
export function applyReceiptChanges(data: AppData, changes: PlanningReceiptChanges): AppData {
  const next: AppData = { ...data }
  const touched = new Set<AppDataKey>([
    ...changes.upserts.map(({ entity }) => entity),
    ...changes.removed.map(({ entity }) => entity),
  ])
  if (touched.size === 0) return data
  for (const entity of touched) {
    const rows = new Map<string, { id: string }>(data[entity].map((row) => [row.id, row]))
    for (const removed of changes.removed) {
      if (removed.entity === entity) rows.delete(removed.id)
    }
    for (const upsert of changes.upserts) {
      if (upsert.entity === entity) rows.set(upsert.row.id, upsert.row)
    }
    ;(next as Record<AppDataKey, unknown[]>)[entity] = [...rows.values()]
  }
  return next
}
