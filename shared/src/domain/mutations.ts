import { newId } from '../lib/id'
import { validateAllocationAssignment, validateDateRange } from '../lib/integrity'
import { sanitizeImportedRecord } from '../lib/sanitizeImport'
import { buildInternalClient, internalClientFor, INTERNAL_CLIENT_COLOR, INTERNAL_CLIENT_NAME } from '../data/internalClient'
import { belongsToAccount, notInAccount } from './tenancy'
import { isExternalResource, SCOPED_KEYS, scopedTables } from '../types/entities'
import type {
  Allocation,
  AppData,
  ID,
  ISODate,
  ISOTimestamp,
  Resource,
  ScopedEntity,
  ScopedEntityKey,
  Activity,
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
  if (!belongsToAccount(row, accountId)) {
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
    typeof id === 'string' && table.some((e) => e.id === id && belongsToAccount(e, accountId))
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
    case 'activities': {
      // Activity.kind coherence, checked first: a 'project' activity MUST carry a project; an
      // 'internal'/'repeatable' activity is project-less by definition, so it may carry NEITHER a
      // project nor a phase. (Only enforced when kind is present — a partial patch that doesn't
      // touch kind is validated against the merged row by the store, which always has it.)
      if (present('kind')) {
        const kind = rec.kind
        if (kind === 'project') {
          if (!present('projectId')) throw new Error('A project activity must be assigned to a project.')
        } else if (kind === 'internal' || kind === 'repeatable') {
          if (present('projectId')) throw new Error('An internal or repeatable activity cannot belong to a project.')
          if (present('phaseId')) throw new Error('An internal or repeatable activity cannot belong to a phase.')
        }
      }
      need('projectId', data.projects, 'Activity must reference a project in this company.')
      // A phase belongs to exactly one project, so an activity's phase must be a phase OF
      // the activity's own project — otherwise the activity is silently double-bound to two
      // projects, and deleting the phase's project orphans the activity's phaseId.
      if (present('phaseId')) {
        // Resolve the in-account phase ONCE: its absence is the "belong to this company"
        // failure (same check `need` would do), and its projectId feeds the coherence
        // check below — no second scan of data.phases.
        const phase = data.phases.find(
          (p) => p.id === rec.phaseId && belongsToAccount(p, accountId),
        )
        if (!phase) throw new Error('Activity phase must belong to this company.')
        if (!present('projectId')) {
          throw new Error('An activity with a phase must also belong to that phase’s project.')
        }
        if (phase.projectId !== rec.projectId) {
          throw new Error('Activity phase must belong to the activity’s project.')
        }
      }
      break
    }
    case 'resources':
      need('disciplineId', data.disciplines, 'Resource discipline must belong to this company.')
      need('projectId', data.projects, 'Placeholder project must belong to this company.')
      break
    // allocations / timeOff: their refs are checked by assertAllocationRefs /
    // assertResourceExists (scoped to the active account), below.
  }
}

/**
 * An allocation must reference a real resource + activity IN THE ACTIVE ACCOUNT, a
 * placeholder may only take activities from its bound project, and an external /
 * 3rd-party resource (which has no capacity) may only carry a zero load. `hoursPerDay`
 * is REQUIRED — every allocation write knows its load, and making the parameter
 * mandatory forces the compiler to surface it so the capacity-free rule below can never
 * be silently skipped by a future caller (the old optional arg made that invariant
 * opt-in per call site).
 */
export function assertAllocationRefs(
  data: AppData,
  accountId: ID,
  resourceId: ID,
  activityId: ID,
  hoursPerDay: number,
): void {
  const resource = data.resources.find((r) => r.id === resourceId && belongsToAccount(r, accountId))
  const activity = data.activities.find((t) => t.id === activityId && belongsToAccount(t, accountId))
  if (!resource || !activity) {
    throw new Error('Allocation must reference an existing resource and activity in this company.')
  }
  const v = validateAllocationAssignment(resource, activity.projectId)
  // `errors[0]` is guaranteed present: every validator sets ok=false and pushes a message in the
  // same step, so `!v.ok` always implies a non-empty `errors` array. (Documented coupling between
  // ValidationResult.ok and errors — don't split the two without revisiting this read.)
  if (!v.ok) throw new Error(v.errors[0])
  // External / 3rd parties have NO capacity: their allocations carry no load (hoursPerDay 0). The
  // form forces 0 and a drag-reassign reconciles to 0, but those are UI-only — enforce it at the
  // write boundary too so a direct store / API write can't land a phantom load on a capacity-free
  // resource (the scheduler hides it, so it would persist invisibly). Import coerces the same value
  // to 0 instead of dropping the booking, which is still valid. Always checked: `hoursPerDay` is a
  // required parameter, so no caller can opt out of the rule.
  if (hoursPerDay !== 0 && isExternalResource(resource)) {
    throw new Error('An external / 3rd-party resource’s allocation can’t carry hours.')
  }
}

/**
 * A resource may only BE external if it carries no disallowed dependents. The v0.8.1 rule
 * ("an external / 3rd-party resource has no capacity, so no loaded allocation and no time off")
 * is enforced at the allocation/time-off write boundary by assertAllocationRefs /
 * assertResourceExists — but a resource's `kind` can be flipped to external AFTER it already owns
 * those dependents, which nothing re-validates: the scheduler then HIDES the now-external capacity
 * and time-off, recreating the invisible-orphan state v0.8.1 closed.
 *
 * The store and server are the integrity boundary, so we REJECT the flip rather than silently
 * zeroing hours / dropping time-off (surprising data loss as a side effect of a name/colour-style
 * edit). The owner must reassign or remove the work + time off FIRST. Symmetric with
 * assertAllocationRefs / assertResourceExists, which reject the inverse write. Only fires on the
 * external case (a person/placeholder write is unaffected). `mergedKind` is the kind the resource
 * WILL have after the write (`patch.kind ?? existing.kind` in the store, the merged row's kind on
 * the server); when it's not external this is a pure no-op. Import keeps RECONCILING instead
 * (remapAndValidateImport coerces the load to 0 and drops the time-off) — a bulk file is a
 * different contract from an interactive edit, so don't route it here.
 */
export function assertResourceKindAllowsDependents(
  data: AppData,
  accountId: ID,
  resourceId: ID,
  mergedKind: unknown,
): void {
  if (!isExternalResource({ kind: mergedKind as Resource['kind'] })) return
  const owns = (e: Allocation | TimeOff) => e.resourceId === resourceId && belongsToAccount(e, accountId)
  // A loaded allocation OR any time-off both vanish from the scheduler once the resource is external.
  // hoursPerDay !== 0 mirrors assertAllocationRefs' "externals carry no load" rule (a zero-load
  // allocation is allowed on an external, so it doesn't block the flip).
  const hasLoadedAllocation = data.allocations.some((a) => owns(a) && a.hoursPerDay !== 0)
  const hasTimeOff = data.timeOff.some((t) => owns(t))
  if (hasLoadedAllocation || hasTimeOff) {
    throw new Error('Reassign or remove this resource’s work and time off before making it external.')
  }
}

/** No allocation or time-off may persist an empty, malformed, or reversed range. */
export function assertDateRange(startDate?: ISODate, endDate?: ISODate): void {
  const v = validateDateRange(startDate, endDate)
  // errors[0] is safe — see assertAllocationRefs: !ok always implies at least one pushed message.
  if (!v.ok) throw new Error(v.errors[0])
}

/**
 * Time off references a resource in the active account, exactly as an allocation does —
 * and that resource must be capacity-tracked. An external / 3rd party has no capacity, so
 * time off is meaningless for it (the scheduler hides external time-off entirely): the form
 * omits externals from the picker AND rejects a crafted pick, so enforce the SAME rule here
 * so a direct store / API write can't persist an invisible orphan.
 */
export function assertResourceExists(data: AppData, accountId: ID, resourceId: ID): void {
  const resource = data.resources.find((r) => r.id === resourceId && belongsToAccount(r, accountId))
  if (!resource) {
    throw new Error('Time off must reference an existing resource in this company.')
  }
  if (isExternalResource(resource)) {
    throw new Error('Time off can’t be recorded for an external / 3rd-party resource.')
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
    dst[key] = src[key].filter(notInAccount(accountId))
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
  now: ISOTimestamp,
): { data: AppData; imported: number; skipped: number } {
  // FK remap tables, ONE PER ENTITY TYPE. A source id is only meaningful within its own
  // table, so a single GLOBAL map keyed on the bare id string would let a CROSS-TABLE id
  // collision (two records in different tables that corruptly share an id) misroute every
  // FK pointing at one of them — silently dropping the referencing record and its subtree.
  // Per-table maps resolve each FK against the table it actually references. FIRST
  // occurrence within a table wins; a record with a missing/non-string id is NOT keyed
  // (keying on `undefined` would collapse them all) — it gets a fresh id below.
  const idMaps = Object.fromEntries(SCOPED_KEYS.map((k) => [k, new Map<ID, ID>()])) as Record<
    ScopedEntityKey,
    Map<ID, ID>
  >
  for (const key of SCOPED_KEYS) {
    for (const e of incoming[key] as Array<{ id?: unknown }>) {
      if (typeof e?.id === 'string' && !idMaps[key].has(e.id)) idMaps[key].set(e.id, newId())
    }
  }
  // Each foreign-key field points at exactly one table, so a ref is remapped via THAT
  // table's id map (a dangling ref — absent from the map — is left as-is, repaired below).
  // Type annotation ensures every value is a valid ScopedEntityKey — a typo or a
  // renamed table fails the type-check here rather than silently remapping to undefined.
  const FK_TARGET: Record<string, ScopedEntityKey> = {
    disciplineId: 'disciplines',
    projectId: 'projects',
    clientId: 'clients',
    phaseId: 'phases',
    resourceId: 'resources',
    activityId: 'activities',
  }
  const FK_FIELDS = Object.keys(FK_TARGET)
  const remap = (field: string, ref: unknown): unknown => {
    const m = idMaps[FK_TARGET[field]]
    return typeof ref === 'string' && m.has(ref) ? m.get(ref) : ref
  }

  // Remap every incoming scoped entity into the active account, then repair its
  // value-level fields (enums / numerics / colour). Keep them as loose records so
  // the referential pass below can null a dangling optional FK in place. Each record
  // gets its OWN fresh id: the first record bearing a given source id reuses the
  // FK-map's id (so references land on it), but a later DUPLICATE gets a brand-new id
  // so two rows can never collide on one primary key. Timestamps are stamped fresh
  // (`now`) — these records are newly created in this account, and a file missing
  // createdAt/updatedAt must not reach a server whose columns are NOT NULL.
  const usedIds = new Set<ID>()
  const brought: Record<string, Array<Record<string, unknown>>> = {}
  for (const key of SCOPED_KEYS) {
    const ownIds = idMaps[key]
    brought[key] = (incoming[key] as unknown as Array<Record<string, unknown>>).map((e) => {
      // `ownIds.get(e.id) as ID` is sound: the FIRST loop above seeded this table's map with a
      // fresh id for EVERY record bearing a string id, so any record reaching here with a string
      // id is guaranteed to have an entry. A missing/non-string id falls to a fresh newId().
      const mapped = typeof e.id === 'string' ? (ownIds.get(e.id) as ID) : newId()
      const newRecordId = usedIds.has(mapped) ? newId() : mapped
      usedIds.add(newRecordId)
      const copy: Record<string, unknown> = { ...e, id: newRecordId, accountId, createdAt: now, updatedAt: now }
      for (const f of FK_FIELDS) {
        if (copy[f] !== undefined) copy[f] = remap(f, copy[f])
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

  // Built-in "Internal" client: every account must have EXACTLY ONE (seed / addAccount / migrate
  // guarantee it). Import REPLACES the account's whole slice (the kept-existing rows are filtered out
  // below), so we can't just keep the pre-existing Internal — it would be wiped. Normalise the
  // imported builtins to AT MOST one here, then `ensureInternalClients` (a post-step, after counting)
  // synthesises one if the file carried none — so an auto-added Internal is never counted toward
  // `imported`. The normalisation:
  //   • keep the FIRST imported builtin (re-stamping its name/colour to the reserved pair so a
  //     hand-edited file can't smuggle a junk "Internal"), and remap every OTHER imported builtin's
  //     id to that kept one (so anything they owned re-points at the single Internal).
  const remappedBuiltinId = new Map<string, string>()
  let keptInternalId: string | undefined
  brought.clients = brought.clients.filter((c) => {
    if (c.builtin !== true) return true
    if (keptInternalId === undefined) {
      keptInternalId = c.id as string
      c.name = INTERNAL_CLIENT_NAME
      c.color = INTERNAL_CLIENT_COLOR
      return true // this row becomes the account's single Internal
    }
    remappedBuiltinId.set(c.id as string, keptInternalId) // a duplicate builtin → fold into the kept one
    return false
  })
  // Re-point any FK that pointed at a folded-away imported builtin client at the single kept Internal
  // (projects.clientId is the only client FK). Done before the required-FK drop so the project keeps a
  // valid client and survives.
  const rewireBuiltin = (v: unknown): unknown =>
    typeof v === 'string' && remappedBuiltinId.has(v) ? remappedBuiltinId.get(v) : v
  for (const p of brought.projects) p.clientId = rewireBuiltin(p.clientId)

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

  // activities: keep kind ⇆ projectId/phaseId coherent (assertScopedRefs throws on a mismatch, and
  // import bypasses it). An internal/repeatable activity is project-less — strip any project/phase it
  // carries. A project activity whose project didn't survive can no longer BE a project activity, so it
  // becomes 'repeatable' (and loses its now-orphaned phase). A surviving phase that belongs to a
  // DIFFERENT project is unbound — an activity's phase must be a phase of the activity's own project.
  const phaseProject = new Map(brought.phases.map((p) => [p.id as string, p.projectId]))
  for (const t of brought.activities) {
    if (t.kind === 'internal' || t.kind === 'repeatable') {
      t.projectId = undefined
      t.phaseId = undefined
      continue
    }
    if (t.projectId !== undefined && !has(projectIds, t.projectId)) t.projectId = undefined
    if (t.projectId === undefined) {
      t.phaseId = undefined
      t.kind = 'repeatable'
    } else if (
      t.phaseId !== undefined &&
      (!has(phaseIds, t.phaseId) || phaseProject.get(t.phaseId as string) !== t.projectId)
    ) {
      t.phaseId = undefined
    }
  }

  // allocations / time-off: resource + activity are REQUIRED. Also enforce the date range
  // and the placeholder rule, exactly as the store / server validators do. (An
  // allocation to a now-unbound placeholder on a project activity fails the placeholder
  // rule and is dropped here — the same outcome the store would produce.)
  // The `as unknown as <Entity>[]` casts in this block are sound: every row in `brought[*]` was
  // just produced by sanitizeImportedRecord (value-level fields coerced to their typed shape) and
  // stamped with id/accountId/timestamps, so reading them as typed entities for the referential
  // checks below is safe. Results are cast back to loose records afterwards so a dangling optional
  // FK can still be nulled in place. Field-level safety lives in sanitize/validate — NOT the cast.
  const resources = new Map((brought.resources as unknown as Resource[]).map((r) => [r.id, r]))
  const activities = new Map((brought.activities as unknown as Activity[]).map((t) => [t.id, t]))
  // Single pass: resolve the owning resource ONCE per allocation and use it for BOTH the keep/drop
  // decision (date range + resource/activity existence + placeholder rule) AND the external-load
  // coercion below, so the two can never diverge.
  brought.allocations = (brought.allocations as unknown as Allocation[]).reduce<Allocation[]>(
    (kept, a) => {
      if (!validateDateRange(a.startDate, a.endDate).ok) return kept
      const resource = resources.get(a.resourceId)
      const activity = activities.get(a.activityId)
      if (!resource || !activity) return kept
      if (!validateAllocationAssignment(resource, activity.projectId).ok) return kept
      // An external resource's allocations carry NO load (the form forces hoursPerDay 0). Import is
      // the one write path that bypasses the form, and sanitizeImportedRecord is per-record so it
      // can't see the owning resource's kind — coerce it here, where the whole resource set is in
      // scope, so a hand-edited/legacy file can't land a non-zero load on a capacity-free resource.
      kept.push(isExternalResource(resource) && a.hoursPerDay !== 0 ? { ...a, hoursPerDay: 0 } : a)
      return kept
    },
    [],
  ) as unknown as Array<Record<string, unknown>>
  brought.timeOff = (brought.timeOff as unknown as TimeOff[]).filter((t) => {
    // Drop time off on an external / 3rd-party resource: they have no capacity, so the store / server
    // reject it at the write boundary (assertResourceExists) and the scheduler hides it. Applying the
    // same rule here keeps import from landing an invisible orphan a hand-edited file could carry.
    const resource = resources.get(t.resourceId)
    return resource !== undefined && !isExternalResource(resource) && validateDateRange(t.startDate, t.endDate).ok
  }) as unknown as Array<Record<string, unknown>>

  const next: AppData = { ...data }
  const srcKept = scopedTables(data)
  const dst = scopedTables(next)
  // Count only NON-builtin clients toward `imported`: the built-in Internal is infrastructure (every
  // account has exactly one regardless of the file), so a kept/folded/synthesised Internal must never
  // inflate "imported N". This also fixes the over-report when a pre-v6 FULL export was given a builtin
  // by migrate (run before this import) — that auto-added row reaches here as a kept builtin, and must
  // still not count. The matching `totalIncoming` below excludes incoming builtins for the same reason.
  const countable = (key: ScopedEntityKey, rows: ReadonlyArray<Record<string, unknown>>): number =>
    key === 'clients' ? rows.filter((c) => c.builtin !== true).length : rows.length
  let imported = 0
  for (const key of SCOPED_KEYS) {
    const kept = srcKept[key].filter(notInAccount(accountId))
    dst[key] = [...kept, ...(brought[key] as unknown as ScopedEntity[])]
    imported += countable(key, brought[key])
  }
  // Post-step (AFTER counting): guarantee the ACTIVE account ends with exactly one built-in Internal.
  // Import only replaces the active account's slice, so scope the ensure to it (every OTHER account
  // keeps its own Internal untouched — and import must not mint Internals for accounts it didn't
  // touch). Idempotent — a no-op when the kept-first path above already left a builtin for this
  // account; it only synthesises one when the file carried none. Counting is already done, so a
  // synthesised Internal is never counted. This is `ensureInternalClients` (the canonical "exactly one
  // Internal per account" algorithm) narrowed to a single account.
  const result = internalClientFor(next.clients, accountId)
    ? next
    : { ...next, clients: [...next.clients, buildInternalClient(accountId, now)] }
  // Everything that didn't land — a dropped parent, child, allocation or time-off — counts as skipped
  // (records merely unbound from a dangling optional FK still land). Incoming builtins are excluded
  // from BOTH sides so the auto-added Internal never shows up as imported or skipped.
  const totalIncoming = SCOPED_KEYS.reduce(
    (n, key) => n + countable(key, (incoming[key] as unknown as Array<Record<string, unknown>> | undefined) ?? []),
    0,
  )
  return { data: result, imported, skipped: totalIncoming - imported }
}
