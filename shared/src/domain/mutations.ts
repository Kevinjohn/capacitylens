import { newId } from '../lib/id'
import { validateAllocationAssignment, validateDateRange } from '../lib/integrity'
import { sanitizeImportedRecord } from '../lib/sanitizeImport'
import { SCOPED_KEYS, scopedTables } from '../types/entities'
import type {
  Allocation,
  AppData,
  ID,
  ISODate,
  Resource,
  ScopedEntity,
  ScopedEntityKey,
  Task,
  TimeOff,
} from '../types/entities'

// Pure, environment-agnostic domain mutations + integrity assertions extracted
// from the Zustand store so the SAME logic can run on a future server (and be
// unit-tested once, against both). Nothing here touches React / Zustand / DOM /
// localStorage. The store stays the orchestrator: it resolves the active account
// and owns the clock (id/createdAt/updatedAt); these functions validate refs and
// compute the next AppData. All cascade/transform helpers return a NEW AppData.
//
// Account resolution itself (the "no active account" guard) deliberately stays in
// the store — it reads live UI state. Every function here takes `accountId`
// explicitly so it has no ambient dependency.

/**
 * Strict tenancy at the WRITE boundary. An update/delete must own its target:
 *   - ABSENT row  → return null; the caller no-ops (preserves the silent-no-op
 *     contract for a stale id, e.g. a drag committed after an undo).
 *   - CROSS-ACCOUNT row → throw; a real integrity violation no legitimate flow
 *     produces. Returns the owned row so callers can read its current values.
 */
export function findOwned<K extends ScopedEntityKey>(
  data: AppData,
  accountId: ID,
  key: K,
  id: ID,
): AppData[K][number] | null {
  const row = (data[key] as ScopedEntity[]).find((e) => e.id === id)
  if (!row) return null
  if (row.accountId !== accountId) {
    throw new Error('That record does not belong to the active company.')
  }
  return row as AppData[K][number]
}

/**
 * Every foreign key on a new/updated scoped record must point at a row in the
 * SAME account. Only the FK fields actually PRESENT on `rec` are checked, so it
 * works for both a full add and a partial update patch.
 */
export function assertScopedRefs(
  data: AppData,
  accountId: ID,
  key: ScopedEntityKey,
  rec: Record<string, unknown>,
): void {
  const present = (field: string) => rec[field] !== undefined && rec[field] !== null
  const inAccount = (table: ScopedEntity[], id: unknown): boolean =>
    typeof id === 'string' && table.some((e) => e.id === id && e.accountId === accountId)
  const need = (field: string, table: ScopedEntity[], msg: string) => {
    if (present(field) && !inAccount(table, rec[field])) throw new Error(msg)
  }
  switch (key) {
    case 'projects':
      need('clientId', data.clients, 'Project must reference a client in this company.')
      break
    case 'phases':
      need('projectId', data.projects, 'Phase must reference a project in this company.')
      break
    case 'tasks':
      need('projectId', data.projects, 'Task must reference a project in this company.')
      need('phaseId', data.phases, 'Task phase must belong to this company.')
      break
    case 'resources':
      need('disciplineId', data.disciplines, 'Resource discipline must belong to this company.')
      need('projectId', data.projects, 'Placeholder project must belong to this company.')
      break
    // allocations / timeOff: their refs are checked by assertAllocationRefs /
    // assertResourceExists (scoped to the active account), below.
  }
}

/**
 * An allocation must reference a real resource + task IN THE ACTIVE ACCOUNT, and
 * a placeholder may only take tasks from its bound project.
 */
export function assertAllocationRefs(
  data: AppData,
  accountId: ID,
  resourceId: ID,
  taskId: ID,
): void {
  const resource = data.resources.find((r) => r.id === resourceId && r.accountId === accountId)
  const task = data.tasks.find((t) => t.id === taskId && t.accountId === accountId)
  if (!resource || !task) {
    throw new Error('Allocation must reference an existing resource and task in this company.')
  }
  const v = validateAllocationAssignment(resource, task.projectId)
  if (!v.ok) throw new Error(v.errors[0])
}

/** No allocation or time-off may persist an empty, malformed, or reversed range. */
export function assertDateRange(startDate?: ISODate, endDate?: ISODate): void {
  const v = validateDateRange(startDate, endDate)
  if (!v.ok) throw new Error(v.errors[0])
}

/** Time off references a resource exactly as an allocation does. */
export function assertResourceExists(data: AppData, accountId: ID, resourceId: ID): void {
  if (!data.resources.some((r) => r.id === resourceId && r.accountId === accountId)) {
    throw new Error('Time off must reference an existing resource in this company.')
  }
}

/**
 * Cascade-drop an account and every scoped entity belonging to it. Returns a new
 * AppData (mutating a fresh copy in place — scopedTables returns the same ref).
 */
export function deleteAccountCascade(data: AppData, accountId: ID): AppData {
  const next: AppData = { ...data, accounts: data.accounts.filter((a) => a.id !== accountId) }
  const src = scopedTables(data)
  const dst = scopedTables(next)
  for (const key of SCOPED_KEYS) {
    dst[key] = src[key].filter((e) => e.accountId !== accountId)
  }
  return next
}

/**
 * Replace the active account's slice with an imported dataset. Imported entities
 * keep their relationships but are given FRESH ids (an exported file carries the
 * source account's ids; the store matches entities by id GLOBALLY, so a shared id
 * would let an edit in one account silently rewrite another's row). Value-level
 * fields are repaired (the import path bypasses the form validators) and every
 * referential rule the store/server enforce is applied: a record whose REQUIRED
 * foreign key dangles after remap is dropped, a dangling OPTIONAL key is unbound,
 * and allocations / time-off with a broken range or placeholder-rule violation are
 * dropped. This matters doubly for the server import path — a leftover dangling ref
 * would be rejected by SQLite's foreign keys and fail the whole import. Returns the
 * next AppData plus how many records landed vs. were skipped.
 */
export function remapAndValidateImport(
  data: AppData,
  accountId: ID,
  incoming: AppData,
): { data: AppData; imported: number; skipped: number } {
  const idMap = new Map<ID, ID>()
  // Give every record that HAS a string id a fresh one. Records with a
  // missing/non-string id are NOT keyed here (keying on `undefined` would
  // collapse them all onto one shared id) — they each get a fresh id below.
  for (const key of SCOPED_KEYS) {
    for (const e of incoming[key] as Array<{ id?: unknown }>) {
      if (typeof e?.id === 'string') idMap.set(e.id, newId())
    }
  }
  // Foreign-key fields across the scoped entities; remap only those that point at
  // another imported entity (a dangling ref is left as-is, to be repaired below).
  const FK_FIELDS = ['disciplineId', 'projectId', 'clientId', 'phaseId', 'resourceId', 'taskId'] as const
  const remap = (ref: unknown): unknown =>
    typeof ref === 'string' && idMap.has(ref) ? idMap.get(ref) : ref

  // Remap every incoming scoped entity into the active account, then repair its
  // value-level fields (enums / numerics / colour). Keep them as loose records so
  // the referential pass below can null a dangling optional FK in place.
  const brought: Record<string, Array<Record<string, unknown>>> = {}
  for (const key of SCOPED_KEYS) {
    brought[key] = (incoming[key] as unknown as Array<Record<string, unknown>>).map((e) => {
      const newRecordId = typeof e.id === 'string' ? (idMap.get(e.id) ?? newId()) : newId()
      const copy: Record<string, unknown> = { ...e, id: newRecordId, accountId }
      for (const f of FK_FIELDS) {
        if (copy[f] !== undefined) copy[f] = remap(copy[f])
      }
      return sanitizeImportedRecord(key, copy)
    })
  }

  // Referential repair, parent-before-child so a child sees the SURVIVING parent set
  // (a parent dropped here drops its now-orphaned children too). A required FK that
  // dangles drops the record; an optional FK that dangles is unbound so the record
  // survives. Mirrors the DB's own ON DELETE rules (CASCADE for required, SET NULL
  // for optional) and keeps a hand-edited file from reaching SQLite with a bad ref.
  const idSet = (rows: Array<Record<string, unknown>>) => new Set(rows.map((r) => r.id as string))
  const has = (set: Set<string>, v: unknown): boolean => typeof v === 'string' && set.has(v)

  const clientIds = idSet(brought.clients)
  const disciplineIds = idSet(brought.disciplines)

  // projects.clientId is REQUIRED → drop a project whose client didn't survive.
  brought.projects = brought.projects.filter((p) => has(clientIds, p.clientId))
  const projectIds = idSet(brought.projects)

  // phases.projectId is REQUIRED → drop a phase whose project didn't survive.
  brought.phases = brought.phases.filter((ph) => has(projectIds, ph.projectId))
  const phaseIds = idSet(brought.phases)

  // resources: disciplineId / placeholder projectId are OPTIONAL → unbind if dangling.
  for (const r of brought.resources) {
    if (r.disciplineId !== undefined && !has(disciplineIds, r.disciplineId)) r.disciplineId = undefined
    if (r.projectId !== undefined && !has(projectIds, r.projectId)) r.projectId = undefined
  }

  // tasks: projectId / phaseId are OPTIONAL. A dangling project unbinds the task to a
  // general (no-project) task; a general task carries no phase, so drop its phase too.
  for (const t of brought.tasks) {
    if (t.projectId !== undefined && !has(projectIds, t.projectId)) t.projectId = undefined
    if (t.projectId === undefined) t.phaseId = undefined
    else if (t.phaseId !== undefined && !has(phaseIds, t.phaseId)) t.phaseId = undefined
  }

  // allocations / time-off: resource + task are REQUIRED. Also enforce the date range
  // and the placeholder rule, exactly as the store / server validators do. (An
  // allocation to a now-unbound placeholder on a project task fails the placeholder
  // rule and is dropped here — the same outcome the store would produce.)
  const resources = new Map((brought.resources as unknown as Resource[]).map((r) => [r.id, r]))
  const tasks = new Map((brought.tasks as unknown as Task[]).map((t) => [t.id, t]))
  brought.allocations = (brought.allocations as unknown as Allocation[]).filter((a) => {
    if (!validateDateRange(a.startDate, a.endDate).ok) return false
    const resource = resources.get(a.resourceId)
    const task = tasks.get(a.taskId)
    if (!resource || !task) return false
    return validateAllocationAssignment(resource, task.projectId).ok
  }) as unknown as Array<Record<string, unknown>>
  brought.timeOff = (brought.timeOff as unknown as TimeOff[]).filter(
    (t) => resources.has(t.resourceId) && validateDateRange(t.startDate, t.endDate).ok,
  ) as unknown as Array<Record<string, unknown>>

  const next: AppData = { ...data }
  const srcKept = scopedTables(data)
  const dst = scopedTables(next)
  let imported = 0
  for (const key of SCOPED_KEYS) {
    const kept = srcKept[key].filter((e) => e.accountId !== accountId)
    dst[key] = [...kept, ...(brought[key] as unknown as ScopedEntity[])]
    imported += brought[key].length
  }
  // Everything that didn't land — a dropped parent, child, allocation or time-off —
  // counts as skipped (records merely unbound from a dangling optional FK still land).
  const totalIncoming = SCOPED_KEYS.reduce((n, key) => n + ((incoming[key] as unknown[])?.length ?? 0), 0)
  return { data: next, imported, skipped: totalIncoming - imported }
}
