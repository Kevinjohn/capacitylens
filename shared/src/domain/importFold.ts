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

type ImportRow = Record<string, unknown>;
type ImportTables = Record<ScopedEntityKey, ImportRow[]>;
type ImportIdMaps = Record<ScopedEntityKey, Map<ID, ID>>;

interface ImportInput {
  data: AppData;
  accountId: ID;
  incoming: AppData;
  now: ISOTimestamp;
}

interface PreparedImport {
  rows: ImportTables;
  malformed: number;
}

interface ImportContext {
  accountId: ID;
  brought: ImportTables;
}

interface AllocationContext {
  accountId: ID;
  resources: Map<ID, Resource>;
  activities: Map<ID, Activity>;
  projects: Map<unknown, ImportRow>;
}

interface AttributionInput {
  allocation: Allocation;
  resource: Resource;
  activity: Activity;
  context: AllocationContext;
}

interface RemapInput extends ImportInput {
  rows: ImportTables;
  idMaps: ImportIdMaps;
}

const FK_TARGET: Record<string, ScopedEntityKey> = {
  disciplineId: "disciplines",
  projectId: "projects",
  clientId: "clients",
  phaseId: "phases",
  resourceId: "resources",
  activityId: "activities",
};

function prepareIncoming(incoming: AppData): PreparedImport {
  for (const key of SCOPED_KEYS) {
    if (!Array.isArray(incoming[key])) throw new TypeError(`Imported ${key} table must be a list.`);
  }
  const rows = Object.fromEntries(
    SCOPED_KEYS.map((key) => [
      key,
      (incoming[key] as unknown[]).filter(
        (row): row is ImportRow => !!row && typeof row === "object" && !Array.isArray(row),
      ),
    ]),
  ) as ImportTables;
  const malformed = SCOPED_KEYS.reduce((count, key) => count + (incoming[key].length - rows[key].length), 0);
  return { rows, malformed };
}

function buildIdMaps(rows: ImportTables): ImportIdMaps {
  // IDs are table-local: a corrupt cross-table collision must not redirect a foreign key.
  // First occurrence wins so references remain attached to the first duplicate source row.
  const idMaps = Object.fromEntries(SCOPED_KEYS.map((key) => [key, new Map<ID, ID>()])) as ImportIdMaps;
  for (const key of SCOPED_KEYS) {
    for (const entity of rows[key]) {
      if (typeof entity.id === "string" && !idMaps[key].has(entity.id)) idMaps[key].set(entity.id, newId());
    }
  }
  return idMaps;
}

function remapImportedRows({ rows, idMaps, accountId, now }: RemapInput): ImportTables {
  // Remap before sanitising, stamp every row into the destination account, and still give later
  // duplicate source IDs distinct primary keys. Loose rows remain repairable in later passes.
  const brought: ImportTables = {
    disciplines: [],
    resources: [],
    clients: [],
    projects: [],
    phases: [],
    activities: [],
    allocations: [],
    timeOff: [],
    closures: [],
  };
  const usedIds = new Set<ID>();
  for (const key of SCOPED_KEYS) {
    brought[key] = rows[key].map((entity) => {
      const mapped = typeof entity.id === "string" ? (idMaps[key].get(entity.id) as ID) : newId();
      const id = usedIds.has(mapped) ? newId() : mapped;
      usedIds.add(id);
      const copy: ImportRow = { ...entity, id, accountId, createdAt: now, updatedAt: now };
      for (const field of Object.keys(FK_TARGET)) {
        const target = FK_TARGET[field];
        const reference = copy[field];
        if (target !== undefined && typeof reference === "string" && idMaps[target].has(reference)) {
          copy[field] = idMaps[target].get(reference);
        }
      }
      const sanitized = sanitizeImportedRecord(key, copy);
      return key === "resources" && sanitized.deletedAt !== undefined
        ? (obfuscateResource(sanitized as unknown as Resource) as unknown as ImportRow)
        : sanitized;
    });
  }
  return brought;
}

const idSet = (rows: ImportRow[]) => new Set(rows.map((row) => row.id as string));
const has = (set: Set<string>, value: unknown): boolean => typeof value === "string" && set.has(value);

function foldInternalClients(brought: ImportTables): void {
  // Import replaces the account slice, so keep the first built-in client and fold later built-ins
  // into it before required client references are checked. Missing Internal is synthesised later.
  const foldedIds = new Map<string, string>();
  let keptId: string | undefined;
  brought.clients = brought.clients.filter((client) => {
    if (client.builtin !== true) return true;
    if (keptId === undefined) {
      keptId = client.id as string;
      client.name = INTERNAL_CLIENT_NAME;
      client.color = INTERNAL_CLIENT_COLOR;
      return true;
    }
    foldedIds.set(client.id as string, keptId);
    return false;
  });
  for (const project of brought.projects) {
    if (typeof project.clientId === "string" && foldedIds.has(project.clientId)) {
      project.clientId = foldedIds.get(project.clientId);
    }
  }
}

function repairHierarchy(brought: ImportTables): void {
  // Parent-before-child ordering ensures each reference is checked against surviving parents.
  // Required references drop rows; optional resource references are unbound.
  const clientIds = idSet(brought.clients);
  const disciplineIds = idSet(brought.disciplines);
  brought.projects = brought.projects.filter((project) => has(clientIds, project.clientId));
  const projectIds = idSet(brought.projects);
  brought.phases = brought.phases.filter((phase) => has(projectIds, phase.projectId));
  const phaseIds = idSet(brought.phases);
  for (const resource of brought.resources) {
    if (resource.disciplineId !== undefined && !has(disciplineIds, resource.disciplineId)) delete resource.disciplineId;
    if (resource.projectId !== undefined && !has(projectIds, resource.projectId)) delete resource.projectId;
  }
  repairActivities(brought, projectIds, phaseIds);
}

function repairActivities(brought: ImportTables, projectIds: Set<string>, phaseIds: Set<string>): void {
  // Project activities with a missing project retain user data as project-less repeatables;
  // internal and repeatable activities cannot carry project or phase attribution.
  const phaseProject = new Map(brought.phases.map((phase) => [phase.id as string, phase.projectId]));
  for (const activity of brought.activities) {
    if (activity.kind === "internal" || activity.kind === "repeatable") {
      delete activity.projectId;
      delete activity.phaseId;
    } else if (activity.projectId !== undefined && !has(projectIds, activity.projectId)) {
      delete activity.projectId;
    }
    if (activity.kind !== "internal" && activity.kind !== "repeatable" && activity.projectId === undefined) {
      delete activity.phaseId;
      activity.kind = "repeatable";
    } else if (
      activity.phaseId !== undefined &&
      (!has(phaseIds, activity.phaseId) || phaseProject.get(activity.phaseId as string) !== activity.projectId)
    ) {
      delete activity.phaseId;
    }
  }
}

function attributionIsInvalid({ allocation, resource, activity, context }: AttributionInput): boolean {
  if (allocation.projectId === undefined) return false;
  const project = context.projects.get(allocation.projectId);
  return (
    !allocationAttributionAllowed(activity.kind) ||
    project === undefined ||
    project.accountId !== context.accountId ||
    !validateAllocationAssignment(resource, allocation.projectId).ok
  );
}

function eraseDeletedResourceNote(allocation: Allocation, resource: Resource): Allocation {
  if (resource.deletedAt === undefined || allocation.note === undefined) return allocation;
  const withoutNote = { ...allocation };
  delete withoutNote.note;
  return withoutNote;
}

function repairAllocation(allocation: Allocation, context: AllocationContext): Allocation | undefined {
  // Repair optional attribution before applying the effective-project placeholder rule. Resolve
  // the resource once so validation, external-load coercion and deletion erasure cannot diverge.
  if (!validateDateRange(allocation.startDate, allocation.endDate).ok) return undefined;
  const resource = context.resources.get(allocation.resourceId);
  const activity = context.activities.get(allocation.activityId);
  if (!resource || !activity) return undefined;
  let repaired = attributionIsInvalid({ allocation, resource, activity, context })
    ? withoutAllocationAttribution(allocation)
    : allocation;
  if (!validateAllocationAssignment(resource, effectiveProjectId(repaired, activity)).ok) return undefined;
  if (isExternalResource(resource) && repaired.hoursPerDay !== 0) repaired = { ...repaired, hoursPerDay: 0 };
  return eraseDeletedResourceNote(repaired, resource);
}

function repairBookings({ accountId, brought }: ImportContext): void {
  const resources = new Map((brought.resources as unknown as Resource[]).map((resource) => [resource.id, resource]));
  const activities = new Map((brought.activities as unknown as Activity[]).map((activity) => [activity.id, activity]));
  const projects = new Map(brought.projects.map((project) => [project.id, project]));
  brought.allocations = (brought.allocations as unknown as Allocation[])
    .map((allocation) => repairAllocation(allocation, { accountId, resources, activities, projects }))
    .filter((allocation): allocation is Allocation => allocation !== undefined) as unknown as ImportRow[];
  brought.timeOff = (brought.timeOff as unknown as TimeOff[]).reduce<TimeOff[]>((kept, timeOff) => {
    if (!validateDateRange(timeOff.startDate, timeOff.endDate).ok) return kept;
    const resource = resources.get(timeOff.resourceId);
    if (resource === undefined || isExternalResource(resource)) return kept;
    // Deleted-person notes are sensitive dependent text and must cross the import boundary erased.
    if (resource.deletedAt !== undefined && timeOff.note !== undefined) {
      const withoutNote = { ...timeOff };
      delete withoutNote.note;
      kept.push(withoutNote);
    } else kept.push(timeOff);
    return kept;
  }, []) as unknown as ImportRow[];
  brought.closures = (brought.closures as unknown as AppData["closures"]).filter(
    (closure) => validateDateRange(closure.startDate, closure.endDate).ok,
  ) as unknown as ImportRow[];
}

const countable = (key: ScopedEntityKey, rows: ReadonlyArray<ImportRow>): number =>
  key === "clients" ? rows.filter((client) => client.builtin !== true).length : rows.length;

function finishImport(input: ImportInput, brought: ImportTables, prepared: PreparedImport) {
  // Built-in clients are infrastructure, so kept, folded and synthesised rows count on neither side.
  const next: AppData = { ...input.data };
  const source = scopedTables(input.data);
  const destination = scopedTables(next);
  let imported = 0;
  for (const key of SCOPED_KEYS) {
    destination[key] = [
      ...source[key].filter(notInAccount(input.accountId)),
      ...(brought[key] as unknown as ScopedEntity[]),
    ];
    imported += countable(key, brought[key]);
  }
  const data = internalClientFor(next.clients, input.accountId)
    ? next
    : { ...next, clients: [...next.clients, buildInternalClient(input.accountId, input.now)] };
  const total = SCOPED_KEYS.reduce((count, key) => count + countable(key, prepared.rows[key]), prepared.malformed);
  return { data, imported, skipped: total - imported };
}

function runImport(input: ImportInput): { data: AppData; imported: number; skipped: number } {
  const prepared = prepareIncoming(input.incoming);
  const brought = remapImportedRows({
    ...input,
    rows: prepared.rows,
    idMaps: buildIdMaps(prepared.rows),
  });
  foldInternalClients(brought);
  repairHierarchy(brought);
  repairBookings({ accountId: input.accountId, brought });
  return finishImport(input, brought, prepared);
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
 * next AppData plus how many records landed vs. were skipped. `incoming` must be a structurally
 * complete AppData produced by the transfer parser/migrator; a non-array scoped table fails loudly
 * here as defence in depth instead of disappearing from both counters.
 */
function remapAndValidateImport(...[data, accountId, incoming, now]: [AppData, ID, AppData, ISOTimestamp]): {
  data: AppData;
  imported: number;
  skipped: number;
} {
  return runImport({ data, accountId, incoming, now });
}

Object.defineProperty(remapAndValidateImport, "length", { value: 4, configurable: true });

export { remapAndValidateImport };
