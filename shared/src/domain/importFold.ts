import { newId } from "../lib/id";
import {
  allocationAttributionAllowed,
  effectiveProjectId,
  withoutAllocationAttribution,
  validateAllocationAssignment,
  validateDateRange,
} from "../lib/integrity";
import { sanitizeImportedRecord } from "../lib/sanitizeImport";
import {
  buildInternalClient,
  internalClientFor,
  INTERNAL_CLIENT_COLOR,
  INTERNAL_CLIENT_NAME,
} from "../data/internalClient";
import { notInAccount } from "./tenancy";
import { obfuscateResource } from "./lifecycle";
import { isExternalResource, SCOPED_KEYS, scopedTables } from "../types/entities";
import type {
  Activity,
  Allocation,
  AppData,
  ID,
  ISOTimestamp,
  Resource,
  ScopedEntity,
  ScopedEntityKey,
  TimeOff,
} from "../types/entities";

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
 * next AppData plus how many records landed vs. were skipped. `incoming` must be a structurally
 * complete AppData produced by the transfer parser/migrator; a non-array scoped table fails loudly
 * here as defence in depth instead of disappearing from both counters.
 */
export function remapAndValidateImport(
  data: AppData,
  accountId: ID,
  incoming: AppData,
  now: ISOTimestamp,
): { data: AppData; imported: number; skipped: number } {
  for (const key of SCOPED_KEYS) {
    if (!Array.isArray(incoming[key])) throw new TypeError(`Imported ${key} table must be a list.`);
  }
  const incomingRows = Object.fromEntries(
    SCOPED_KEYS.map((key) => {
      const rows = incoming[key] as unknown[];
      return [
        key,
        rows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row)),
      ];
    }),
  ) as Record<ScopedEntityKey, Array<Record<string, unknown>>>;
  const malformedIncoming = SCOPED_KEYS.reduce(
    (count, key) => count + (incoming[key].length - incomingRows[key].length),
    0,
  );
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
  >;
  for (const key of SCOPED_KEYS) {
    for (const e of incomingRows[key]) {
      if (typeof e.id === "string" && !idMaps[key].has(e.id)) idMaps[key].set(e.id, newId());
    }
  }
  // Each foreign-key field points at exactly one table, so a ref is remapped via THAT
  // table's id map (a dangling ref — absent from the map — is left as-is, repaired below).
  // Type annotation ensures every value is a valid ScopedEntityKey — a typo or a
  // renamed table fails the type-check here rather than silently remapping to undefined.
  const FK_TARGET: Record<string, ScopedEntityKey> = {
    disciplineId: "disciplines",
    projectId: "projects",
    clientId: "clients",
    phaseId: "phases",
    resourceId: "resources",
    activityId: "activities",
  };
  const FK_FIELDS = Object.keys(FK_TARGET);
  const remap = (field: string, ref: unknown): unknown => {
    const m = idMaps[FK_TARGET[field]];
    return typeof ref === "string" && m.has(ref) ? m.get(ref) : ref;
  };

  // Remap every incoming scoped entity into the active account, then repair its
  // value-level fields (enums / numerics / colour). Keep them as loose records so
  // the referential pass below can null a dangling optional FK in place. Each record
  // gets its OWN fresh id: the first record bearing a given source id reuses the
  // FK-map's id (so references land on it), but a later DUPLICATE gets a brand-new id
  // so two rows can never collide on one primary key. Timestamps are stamped fresh
  // (`now`) — these records are newly created in this account, and a file missing
  // createdAt/updatedAt must not reach a server whose columns are NOT NULL.
  const usedIds = new Set<ID>();
  const brought: Record<string, Array<Record<string, unknown>>> = {};
  for (const key of SCOPED_KEYS) {
    const ownIds = idMaps[key];
    brought[key] = incomingRows[key].map((e) => {
      // `ownIds.get(e.id) as ID` is sound: the FIRST loop above seeded this table's map with a
      // fresh id for EVERY record bearing a string id, so any record reaching here with a string
      // id is guaranteed to have an entry. A missing/non-string id falls to a fresh newId().
      const mapped = typeof e.id === "string" ? (ownIds.get(e.id) as ID) : newId();
      const newRecordId = usedIds.has(mapped) ? newId() : mapped;
      usedIds.add(newRecordId);
      const copy: Record<string, unknown> = {
        ...e,
        id: newRecordId,
        accountId,
        createdAt: now,
        updatedAt: now,
      };
      for (const f of FK_FIELDS) {
        if (copy[f] !== undefined) copy[f] = remap(f, copy[f]);
      }
      const sanitized = sanitizeImportedRecord(key, copy);
      if (key === "resources" && sanitized.deletedAt !== undefined) {
        return obfuscateResource(sanitized as unknown as Resource) as unknown as Record<string, unknown>;
      }
      return sanitized;
    });
  }

  // Referential repair, parent-before-child so a child sees the SURVIVING parent set
  // (a parent dropped here drops its now-orphaned children too). Generally, a required FK that
  // dangles drops the record and an optional FK is unbound so the record survives. Import is a
  // recovery boundary rather than a database delete, so one deliberate exception preserves more
  // user data than the schema's CASCADE: a project activity whose project is absent survives as a
  // project-less repeatable activity (and loses its phase), as documented again in that pass below.
  // Every repair keeps a hand-edited file from reaching SQLite with an invalid reference.
  const idSet = (rows: Array<Record<string, unknown>>) => new Set(rows.map((r) => r.id as string));
  const has = (set: Set<string>, v: unknown): boolean => typeof v === "string" && set.has(v);

  // Built-in "Internal" client: every account must have EXACTLY ONE (seed / addAccount / migrate
  // guarantee it). This is the IMPORT-FOLD enforcement point (2) of the single-Internal invariant —
  // see the canonical doc in ../data/internalClient.ts (the other two points are store strip + server
  // reject). Import REPLACES the account's whole slice (the kept-existing rows are filtered out
  // below), so we can't just keep the pre-existing Internal — it would be wiped, and a bulk replace
  // can't reject. Normalise the imported builtins to AT MOST one here (keep-first + fold-the-rest),
  // then `ensureInternalClients` (a post-step, after counting)
  // synthesises one if the file carried none — so an auto-added Internal is never counted toward
  // `imported`. The normalisation:
  //   • keep the FIRST imported builtin (the per-record sanitizer re-stamps its name/colour and
  //     clears impossible lifecycle tombstones), and remap every OTHER imported builtin's id to
  //     that kept one (so anything they owned re-points at the single Internal).
  const remappedBuiltinId = new Map<string, string>();
  let keptInternalId: string | undefined;
  brought.clients = brought.clients.filter((c) => {
    if (c.builtin !== true) return true;
    if (keptInternalId === undefined) {
      keptInternalId = c.id as string;
      c.name = INTERNAL_CLIENT_NAME;
      c.color = INTERNAL_CLIENT_COLOR;
      return true; // this row becomes the account's single Internal
    }
    remappedBuiltinId.set(c.id as string, keptInternalId); // a duplicate builtin → fold into the kept one
    return false;
  });
  // Re-point any FK that pointed at a folded-away imported builtin client at the single kept Internal
  // (projects.clientId is the only client FK). Done before the required-FK drop so the project keeps a
  // valid client and survives.
  const rewireBuiltin = (v: unknown): unknown =>
    typeof v === "string" && remappedBuiltinId.has(v) ? remappedBuiltinId.get(v) : v;
  for (const p of brought.projects) p.clientId = rewireBuiltin(p.clientId);

  const clientIds = idSet(brought.clients);
  const disciplineIds = idSet(brought.disciplines);

  // projects.clientId is REQUIRED → drop a project whose client didn't survive.
  brought.projects = brought.projects.filter((p) => has(clientIds, p.clientId));
  const projectIds = idSet(brought.projects);

  // phases.projectId is REQUIRED → drop a phase whose project didn't survive.
  brought.phases = brought.phases.filter((ph) => has(projectIds, ph.projectId));
  const phaseIds = idSet(brought.phases);

  // resources: disciplineId / placeholder projectId are OPTIONAL → unbind if dangling.
  for (const r of brought.resources) {
    if (r.disciplineId !== undefined && !has(disciplineIds, r.disciplineId)) r.disciplineId = undefined;
    if (r.projectId !== undefined && !has(projectIds, r.projectId)) r.projectId = undefined;
  }

  // activities: keep kind ⇆ projectId/phaseId coherent (assertScopedRefs throws on a mismatch, and
  // import bypasses it). An internal/all-projects activity is project-less — strip any project/phase it
  // carries. A project-specific activity whose project didn't survive can no longer BE project-specific, so it
  // becomes 'repeatable' (and loses its now-orphaned phase). A surviving phase that belongs to a
  // DIFFERENT project is unbound — an activity's phase must be a phase of the activity's own project.
  const phaseProject = new Map(brought.phases.map((p) => [p.id as string, p.projectId]));
  for (const act of brought.activities) {
    if (act.kind === "internal" || act.kind === "repeatable") {
      act.projectId = undefined;
      act.phaseId = undefined;
      continue;
    }
    if (act.projectId !== undefined && !has(projectIds, act.projectId)) act.projectId = undefined;
    if (act.projectId === undefined) {
      act.phaseId = undefined;
      act.kind = "repeatable";
    } else if (
      act.phaseId !== undefined &&
      (!has(phaseIds, act.phaseId) || phaseProject.get(act.phaseId as string) !== act.projectId)
    ) {
      act.phaseId = undefined;
    }
  }

  // allocations / time-off: resource + activity are REQUIRED. Repair invalid optional attribution
  // before enforcing the effective-project placeholder rule; a booking is dropped only when an
  // independent required-reference, range or assignment invariant still fails.
  // The `as unknown as <Entity>[]` casts in this block are sound: every row in `brought[*]` was
  // just produced by sanitizeImportedRecord (value-level fields coerced to their typed shape) and
  // stamped with id/accountId/timestamps, so reading them as typed entities for the referential
  // checks below is safe. Results are cast back to loose records afterwards so a dangling optional
  // FK can still be nulled in place. Field-level safety lives in sanitize/validate — NOT the cast.
  const resources = new Map((brought.resources as unknown as Resource[]).map((r) => [r.id, r]));
  const activities = new Map((brought.activities as unknown as Activity[]).map((act) => [act.id, act]));
  const projectById = new Map(brought.projects.map((project) => [project.id, project]));
  // Single pass: resolve the owning resource ONCE per allocation and use it for BOTH the keep/drop
  // decision (date range + resource/activity existence + placeholder rule) AND the external-load
  // coercion below, so the two can never diverge.
  brought.allocations = (brought.allocations as unknown as Allocation[]).reduce<Allocation[]>((kept, a) => {
    if (!validateDateRange(a.startDate, a.endDate).ok) return kept;
    const resource = resources.get(a.resourceId);
    const activity = activities.get(a.activityId);
    if (!resource || !activity) return kept;
    let repaired = a;
    const attributedProject = a.projectId === undefined ? undefined : projectById.get(a.projectId);
    const invalidAttribution =
      a.projectId !== undefined &&
      (!allocationAttributionAllowed(activity.kind) ||
        attributedProject === undefined ||
        attributedProject.accountId !== accountId ||
        !validateAllocationAssignment(resource, a.projectId).ok);
    if (invalidAttribution) repaired = withoutAllocationAttribution(a);
    if (!validateAllocationAssignment(resource, effectiveProjectId(repaired, activity)).ok) return kept;
    // An external resource's allocations carry NO load (the form forces hoursPerDay 0). Import is
    // the one write path that bypasses the form, and sanitizeImportedRecord is per-record so it
    // can't see the owning resource's kind — coerce it here, where the whole resource set is in
    // scope, so a hand-edited/legacy file can't land a non-zero load on a capacity-free resource.
    repaired = isExternalResource(resource) && repaired.hoursPerDay !== 0 ? { ...repaired, hoursPerDay: 0 } : repaired;
    // Resource deletion is an erasure boundary, not only a display-name transition. The normal
    // lifecycle route clears dependent free text; apply the same repair to legacy, restored or
    // hand-edited imports so a tombstone cannot reintroduce private project context.
    if (resource.deletedAt !== undefined && repaired.note !== undefined) {
      repaired = { ...repaired, note: undefined };
    }
    kept.push(repaired);
    return kept;
  }, []) as unknown as Array<Record<string, unknown>>;
  brought.timeOff = (brought.timeOff as unknown as TimeOff[]).reduce<TimeOff[]>((kept, t) => {
    if (!validateDateRange(t.startDate, t.endDate).ok) return kept;
    // Drop time off on an external / 3rd-party resource: they have no capacity, so the store / server
    // reject it at the write boundary (assertResourceExists) and the scheduler hides it. Applying the
    // same rule here keeps import from landing an invisible orphan a hand-edited file could carry.
    const resource = resources.get(t.resourceId);
    if (resource === undefined || isExternalResource(resource)) return kept;
    // Medical/absence detail is the most sensitive dependent free text. Match the lifecycle delete
    // path by retaining the valid scheduling record while removing its note for a deleted person.
    kept.push(resource.deletedAt !== undefined && t.note !== undefined ? { ...t, note: undefined } : t);
    return kept;
  }, []) as unknown as Array<Record<string, unknown>>;
  brought.closures = (brought.closures as unknown as AppData["closures"]).filter(
    (closure) => validateDateRange(closure.startDate, closure.endDate).ok,
  ) as unknown as Array<Record<string, unknown>>;

  const next: AppData = { ...data };
  const srcKept = scopedTables(data);
  const dst = scopedTables(next);
  // Count only NON-builtin clients toward `imported`: the built-in Internal is infrastructure (every
  // account has exactly one regardless of the file), so a kept/folded/synthesised Internal must never
  // inflate "imported N". This also fixes the over-report when a pre-v6 FULL export was given a builtin
  // by migrate (run before this import) — that auto-added row reaches here as a kept builtin, and must
  // still not count. The matching `totalIncoming` below excludes incoming builtins for the same reason.
  const countable = (key: ScopedEntityKey, rows: ReadonlyArray<Record<string, unknown>>): number =>
    key === "clients" ? rows.filter((c) => c.builtin !== true).length : rows.length;
  let imported = 0;
  for (const key of SCOPED_KEYS) {
    const kept = srcKept[key].filter(notInAccount(accountId));
    dst[key] = [...kept, ...(brought[key] as unknown as ScopedEntity[])];
    imported += countable(key, brought[key]);
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
    : {
        ...next,
        clients: [...next.clients, buildInternalClient(accountId, now)],
      };
  // Everything that didn't land — a dropped parent, child, allocation or time-off — counts as skipped
  // (records merely unbound from a dangling optional FK still land). Incoming builtins are excluded
  // from BOTH sides so the auto-added Internal never shows up as imported or skipped.
  const totalIncoming = SCOPED_KEYS.reduce((n, key) => n + countable(key, incomingRows[key]), malformedIncoming);
  return { data: result, imported, skipped: totalIncoming - imported };
}
