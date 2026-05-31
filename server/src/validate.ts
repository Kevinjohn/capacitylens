import {
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertScopedRefs,
} from '../../src/domain/mutations'
import type { AppData, ScopedEntityKey } from '../../src/types/entities'

// Server-side write validation is LITERALLY the client's validation: the same pure
// functions from src/domain/mutations.ts, run against the current DB state. This is
// the whole point of the Phase-0 domain-core extraction — one rule set, one set of
// tests, two runtimes.
//
// `row` is the full entity the client sent (it carries id/accountId/timestamps,
// because the sync adapter diffs whole entities). Referential checks only read the
// FK fields present on the row, so the same call covers create and update.

const SCOPED_REF_TABLES: ScopedEntityKey[] = ['projects', 'phases', 'tasks', 'resources']

export function validateWrite(state: AppData, table: string, row: Record<string, unknown>): void {
  if (table === 'accounts' || table === 'clients' || table === 'disciplines') {
    // No outbound foreign keys to validate (accounts are top-level; clients and
    // disciplines only carry accountId, which the DB's FK enforces).
    return
  }
  const accountId = row.accountId as string
  if (SCOPED_REF_TABLES.includes(table as ScopedEntityKey)) {
    assertScopedRefs(state, accountId, table as ScopedEntityKey, row)
    return
  }
  if (table === 'allocations') {
    assertAllocationRefs(state, accountId, row.resourceId as string, row.taskId as string)
    assertDateRange(row.startDate as string, row.endDate as string)
    return
  }
  if (table === 'timeOff') {
    assertResourceExists(state, accountId, row.resourceId as string)
    assertDateRange(row.startDate as string, row.endDate as string)
    return
  }
}
