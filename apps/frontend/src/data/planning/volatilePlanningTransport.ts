import type { PlanningIntent, PlanningMutationSuccess } from "@capacitylens/backend/planning";
import { newId } from "@capacitylens/shared/lib/id";
import { APP_DATA_KEYS, SCOPED_KEYS, placeholderCapacityDefaults } from "@capacitylens/shared/types/entities";
import type { AppData, AppDataKey } from "@capacitylens/shared/types/entities";
import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import { archive, unarchive } from "@capacitylens/shared/domain/lifecycle";
import {
  assertActivityProjectAllowsDependents,
  assertDateRange,
  assertResourceExists,
  assertResourceKindAllowsDependents,
  assertResourceProjectAllowsDependents,
  assertScopedRefs,
  validateResourceAvailabilityPair,
} from "@capacitylens/shared/domain/mutations";
import { hasUsablePrivateCodeName } from "@capacitylens/shared/domain/privateNames";
import { DomainError } from "@capacitylens/shared/domain/errors";
import { isBuiltinClient } from "@capacitylens/shared/data/internalClient";
import { isWeekdaySet } from "@capacitylens/shared/lib/accountWorkingDays";
import { NEUTRAL_COLOR, snapToPresetColor } from "@capacitylens/shared/lib/color";
import type { Activity, Resource, TimeOff } from "@capacitylens/shared/types/entities";
import { isServerConfigured } from "@/data/apiConfig";
import { stamp, touchAfter } from "@/store/revisions";
import { PlanningControllerError } from "./planningCacheController";
import type { PlanningTransport } from "./planningCacheController";
import { createPlanningTransport } from "./planningTransport";

type Row = { id: string; updatedAt: string; [field: string]: unknown };
type Link = { key: "resources" | "activities"; id: string; field: "disciplineId" | "phaseId"; parentId: string };
type Group = { companyId: string; key: AppDataKey; rows: Row[]; links: Link[] };
type Company = { data: AppData; revision: number; pendingRefetch: boolean };

const conflict = () =>
  new PlanningControllerError("This planning change can no longer be applied.", "validation_error", 409);
const invalid = (message: string) => new PlanningControllerError(message, "validation_error", 400);

function rowId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw conflict();
  return value;
}

function slice(data: AppData, companyId: string): AppData {
  const next = { ...data, accounts: data.accounts.filter((row) => row.id === companyId) };
  for (const key of SCOPED_KEYS) Object.assign(next, { [key]: data[key].filter((row) => row.accountId === companyId) });
  return next;
}

const rows = (data: AppData, key: AppDataKey): Row[] => data[key] as unknown as Row[];
const put = (data: AppData, key: AppDataKey, next: Row[]): void => {
  Object.assign(data, { [key]: next });
};
function find(data: AppData, key: AppDataKey, id: string): Row {
  const row = rows(data, key).find((candidate) => candidate.id === id);
  if (!row) throw conflict();
  return row;
}
function normalizeColor(key: AppDataKey, fields: object, current?: Row): object {
  if (!("color" in fields) || !["accounts", "clients", "projects", "disciplines", "resources"].includes(key))
    return fields;
  const color = fields.color;
  if (key === "disciplines" && color === null) return fields;
  if (typeof color !== "string") throw invalid("A colour must be selected from the available swatches.");
  const kind = "kind" in fields ? fields.kind : current?.kind;
  return {
    ...fields,
    color: key === "resources" && kind === "external" && color === NEUTRAL_COLOR ? color : snapToPresetColor(color),
  };
}
function insert(data: AppData, key: AppDataKey, id: string, fields: object, companyId: string): void {
  if (rows(data, key).some((row) => row.id === id)) throw conflict();
  const defaults = key === "accounts" ? NULLABLE_FIELDS.accounts : NULLABLE_FIELDS[key];
  put(data, key, [
    ...rows(data, key),
    {
      ...defaults,
      ...normalizeColor(key, fields),
      id,
      ...(key === "accounts" ? {} : { accountId: companyId }),
      ...stamp(),
    },
  ]);
}
function patch(data: AppData, key: AppDataKey, id: string, changes: object): void {
  const current = find(data, key, id);
  const normalized = normalizeColor(key, changes, current);
  put(
    data,
    key,
    rows(data, key).map((row) =>
      row.id === id ? { ...current, ...normalized, updatedAt: touchAfter(current.updatedAt) } : row,
    ),
  );
}
function deleteRows(data: AppData, key: AppDataKey, ids: string[], groups: Map<string, Group>): string {
  const selected = ids.map((id) => find(data, key, id));
  const links: Link[] = [];
  if (key === "disciplines" || key === "phases") {
    const childKey = key === "disciplines" ? "resources" : "activities";
    const field = key === "disciplines" ? "disciplineId" : "phaseId";
    for (const child of rows(data, childKey)) {
      if (!ids.includes(String(child[field]))) continue;
      links.push({ key: childKey, id: child.id, field, parentId: String(child[field]) });
      patch(data, childKey, child.id, { [field]: null });
    }
  }
  put(
    data,
    key,
    rows(data, key).filter((row) => !ids.includes(row.id)),
  );
  const groupId = newId();
  groups.set(groupId, { companyId: String(selected[0]?.accountId), key, rows: selected, links });
  return groupId;
}
function restore(data: AppData, group: Group): void {
  if (group.rows.some((row) => rows(data, group.key).some((current) => current.id === row.id))) throw conflict();
  for (const link of group.links) if (find(data, link.key, link.id)[link.field] !== null) throw conflict();
  for (const row of group.rows) {
    try {
      if (group.key === "phases") assertScopedRefs(data, group.companyId, "phases", row);
      if (group.key === "timeOff") assertResourceExists(data, group.companyId, String(row.resourceId));
    } catch (error) {
      if (error instanceof DomainError) throw conflict();
      throw error;
    }
  }
  put(data, group.key, [
    ...rows(data, group.key),
    ...group.rows.map((row) => ({ ...row, updatedAt: touchAfter(row.updatedAt) })),
  ]);
  for (const link of group.links) {
    const child = find(data, link.key, link.id);
    try {
      assertScopedRefs(data, group.companyId, link.key, { ...child, [link.field]: link.parentId }, child);
    } catch (error) {
      if (error instanceof DomainError) throw conflict();
      throw error;
    }
    patch(data, link.key, link.id, { [link.field]: link.parentId });
  }
}
function lifecycle(
  data: AppData,
  key: "clients" | "projects" | "activities" | "resources",
  id: string,
  action: "archive" | "unarchive",
): void {
  const current = find(data, key, id);
  const changed =
    action === "archive" ? archive(current as never, touchAfter(current.updatedAt)) : unarchive(current as never);
  patch(data, key, id, changed);
}

function assertWorkingPattern(resource: Resource): void {
  if (!isWeekdaySet(resource.workingDays) || resource.workingDays.length === 0)
    throw invalid("At least one working day is required, using unique whole-number weekdays from 0 to 6.");
  if (!isWeekdaySet(resource.halfDays) || resource.halfDays.some((day) => !resource.workingDays.includes(day)))
    throw invalid("Half days must be unique whole-number weekdays contained in the working week.");
  const [availabilityCode] = validateResourceAvailabilityPair(
    resource.firstAvailableDate,
    resource.lastAvailableDate,
  ).codes;
  if (availabilityCode)
    throw invalid(
      availabilityCode === "date_reversed"
        ? "End date cannot be before the start date."
        : "Availability dates must be valid calendar dates (YYYY-MM-DD).",
    );
}

function validateCatalogue(
  data: AppData,
  companyId: string,
  key: "clients" | "projects" | "phases" | "activities" | "disciplines",
  fields: Record<string, unknown>,
  previous?: Row,
): void {
  const merged = { ...previous, ...fields };
  if ((key === "clients" || key === "projects") && !hasUsablePrivateCodeName(merged))
    throw invalid(`A private ${key === "clients" ? "client" : "project"} requires a code name.`);
  if (key === "clients" && previous && isBuiltinClient(previous as never))
    throw invalid("The Internal client is built in and cannot be renamed.");
  assertScopedRefs(data, companyId, key, key === "activities" ? merged : fields, previous);
  if (key === "activities" && previous)
    assertActivityProjectAllowsDependents(
      data,
      companyId,
      previous.id,
      merged as unknown as Activity,
      previous as unknown as Activity,
    );
}

function validateResource(data: AppData, companyId: string, fields: Record<string, unknown>, previous?: Row): void {
  const merged = { ...previous, ...fields } as unknown as Resource;
  assertScopedRefs(data, companyId, "resources", fields, previous);
  if (merged.kind === "placeholder") {
    const defaults = placeholderCapacityDefaults();
    if (Object.hasOwn(fields, "engagement") && merged.engagement !== "studio")
      throw invalid("A placeholder must use Studio engagement.");
    for (const key of ["workingDays", "halfDays"] as const) {
      if (!Object.hasOwn(fields, key)) continue;
      const actual = merged[key];
      const expected = defaults[key];
      if (
        !Array.isArray(actual) ||
        actual.length !== expected.length ||
        actual.some((day, index) => day !== expected[index])
      )
        throw invalid(`A placeholder's ${key} must match its default working pattern.`);
    }
  }
  assertWorkingPattern(merged);
  if (previous) {
    assertResourceProjectAllowsDependents(data, companyId, previous.id, merged, previous as unknown as Resource);
    assertResourceKindAllowsDependents(data, companyId, previous.id, merged.kind);
  }
}

function validateTimeOff(data: AppData, companyId: string, fields: Record<string, unknown>, previous?: Row): void {
  const merged = { ...previous, ...fields } as unknown as TimeOff;
  assertResourceExists(data, companyId, merged.resourceId, previous as unknown as TimeOff | undefined);
  assertDateRange(merged.startDate, merged.endDate);
}

function validateClosure(fields: Record<string, unknown>, previous?: Row): void {
  const merged = { ...previous, ...fields };
  if (typeof merged.name !== "string" || merged.name.trim().length === 0)
    throw new DomainError("closure_name_required", "Closure name is required.");
  assertDateRange(merged.startDate as string | undefined, merged.endDate as string | undefined);
}

function apply(data: AppData, companyId: string, intent: PlanningIntent, groups: Map<string, Group>) {
  let replacementGroupId: string | null = null;
  let consumedGroupId: string | null = null;
  let refetch = false;
  switch (intent.operation) {
    case "allocation.create":
      insert(data, "allocations", rowId(intent.allocation.id), intent.allocation, companyId);
      break;
    case "allocation.createGroup": {
      const seriesId = newId();
      for (const row of intent.allocations) insert(data, "allocations", rowId(row.id), { ...row, seriesId }, companyId);
      break;
    }
    case "allocation.update":
      patch(data, "allocations", intent.id, intent.changes);
      break;
    case "allocation.duplicate":
    case "allocation.repeat": {
      const source = find(data, "allocations", intent.sourceAllocationId);
      const occurrences = intent.operation === "allocation.duplicate" ? [intent.occurrence] : intent.occurrences;
      const seriesId = intent.operation === "allocation.repeat" ? newId() : null;
      for (const row of occurrences) insert(data, "allocations", row.id, { ...source, ...row, seriesId }, companyId);
      break;
    }
    case "allocation.delete":
    case "allocation.deleteGroup":
      replacementGroupId = deleteRows(
        data,
        "allocations",
        intent.operation === "allocation.delete" ? [intent.id] : intent.ids,
        groups,
      );
      break;
    case "catalogue.create":
      validateCatalogue(data, companyId, intent.entity.entity, intent.entity.fields);
      insert(data, intent.entity.entity, intent.entity.id, intent.entity.fields, companyId);
      break;
    case "catalogue.update": {
      const { entity, id, changes } = intent.entity;
      validateCatalogue(data, companyId, entity, changes, find(data, entity, id));
      patch(data, entity, id, changes);
      refetch =
        ((entity === "clients" || entity === "projects") && ("isPrivate" in changes || "codeName" in changes)) ||
        (entity === "activities" && "kind" in changes);
      if (entity === "activities" && "kind" in changes && changes.kind !== "project") {
        for (const row of rows(data, "allocations"))
          if (row.activityId === id && row.projectId !== null) patch(data, "allocations", row.id, { projectId: null });
      }
      break;
    }
    case "catalogue.archive":
    case "catalogue.unarchive":
      lifecycle(
        data,
        intent.entity.entity,
        intent.entity.id,
        intent.operation === "catalogue.archive" ? "archive" : "unarchive",
      );
      break;
    case "catalogue.delete":
      replacementGroupId = deleteRows(data, intent.entity.entity, [intent.entity.id], groups);
      break;
    case "resource.create":
      validateResource(data, companyId, intent.fields);
      insert(data, "resources", intent.id, intent.fields, companyId);
      break;
    case "resource.update":
      validateResource(data, companyId, intent.changes, find(data, "resources", intent.id));
      patch(data, "resources", intent.id, intent.changes);
      break;
    case "resource.archive":
    case "resource.unarchive":
      lifecycle(data, "resources", intent.id, intent.operation === "resource.archive" ? "archive" : "unarchive");
      break;
    case "timeOff.create":
      validateTimeOff(data, companyId, intent.timeOff);
      insert(data, "timeOff", rowId(intent.timeOff.id), intent.timeOff, companyId);
      break;
    case "timeOff.repeat":
      for (const row of intent.entries) {
        validateTimeOff(data, companyId, row);
        insert(data, "timeOff", rowId(row.id), row, companyId);
      }
      break;
    case "timeOff.update":
      validateTimeOff(data, companyId, intent.changes, find(data, "timeOff", intent.id));
      patch(data, "timeOff", intent.id, intent.changes);
      break;
    case "timeOff.delete":
    case "timeOff.deleteGroup":
      replacementGroupId = deleteRows(
        data,
        "timeOff",
        intent.operation === "timeOff.delete" ? [intent.id] : intent.ids,
        groups,
      );
      break;
    case "closure.create":
      validateClosure(intent.fields);
      insert(data, "closures", intent.id, intent.fields, companyId);
      break;
    case "closure.update":
      validateClosure(intent.changes, find(data, "closures", intent.id));
      patch(data, "closures", intent.id, intent.changes);
      break;
    case "closure.delete":
      replacementGroupId = deleteRows(data, "closures", [intent.id], groups);
      break;
    case "settings.update":
      patch(data, "accounts", companyId, intent.changes);
      break;
    case "planning.restoreGroup": {
      const group = groups.get(intent.restorationGroupId);
      if (!group || group.companyId !== companyId) throw conflict();
      restore(data, group);
      consumedGroupId = intent.restorationGroupId;
      break;
    }
  }
  return { replacementGroupId, consumedGroupId, refetch };
}

function changed(
  before: AppData,
  after: AppData,
): Extract<PlanningMutationSuccess["projection"], { mode: "patch" }>["changed"] {
  const upserts: Array<{ entity: AppDataKey; row: Row }> = [];
  const removed: Array<{ entity: AppDataKey; id: string }> = [];
  for (const key of APP_DATA_KEYS) {
    const oldRows = new Map(rows(before, key).map((row) => [row.id, row]));
    const newRows = new Map(rows(after, key).map((row) => [row.id, row]));
    // apply() replaces only affected rows, so reference identity identifies exact upserts.
    for (const row of newRows.values()) if (oldRows.get(row.id) !== row) upserts.push({ entity: key, row });
    for (const row of oldRows.values()) if (!newRows.has(row.id)) removed.push({ entity: key, id: row.id });
  }
  return { upserts, removed } as unknown as Extract<
    PlanningMutationSuccess["projection"],
    { mode: "patch" }
  >["changed"];
}

/** Executes the same typed planning intents in page memory; reload resets the demo. */
export function createVolatilePlanningTransport(readData: () => AppData): PlanningTransport {
  const companies = new Map<string, Company>();
  const commitments = new Map<string, { companyId: string; revision: number; restorationGroupId?: string }>();
  const groups = new Map<string, Group>();
  const current = (companyId: string): Company => {
    let company = companies.get(companyId);
    if (!company) {
      company = { data: slice(readData(), companyId), revision: 0, pendingRefetch: false };
      companies.set(companyId, company);
    }
    return company;
  };
  return {
    resetAfterDemoImport(companyId, data) {
      const company = current(companyId);
      company.data = slice(data, companyId);
      company.revision += 1;
      company.pendingRefetch = false;
      for (const [id, group] of groups) if (group.companyId === companyId) groups.delete(id);
      for (const [id, commitment] of commitments) if (commitment.companyId === companyId) commitments.delete(id);
      return company.revision;
    },
    async read(context) {
      const company = current(context.companyId);
      const visible = slice(readData(), context.companyId);
      if (!company.pendingRefetch && JSON.stringify(visible) !== JSON.stringify(company.data)) {
        company.data = visible;
        company.revision += 1;
      }
      company.pendingRefetch = false;
      return { revision: company.revision, canWrite: true, data: company.data };
    },
    async execute(context, execution) {
      const company = current(context.companyId);
      // N9/N10 still mutate the demo store directly; include those page-memory edits in the
      // next typed command's validation even when no explicit planning read intervened.
      const visible = slice(readData(), context.companyId);
      if (!company.pendingRefetch && JSON.stringify(visible) !== JSON.stringify(company.data)) company.data = visible;
      if (commitments.has(execution.mutationId))
        throw new PlanningControllerError("This planning change was already committed.", "mutation_id_reused", 409);
      if (execution.baseRevision !== company.revision)
        throw new PlanningControllerError("The schedule changed before this edit was saved.", "stale_revision", 409);
      const before = company.data;
      const after = { ...before };
      const draftGroups = new Map(groups);
      let result: ReturnType<typeof apply>;
      try {
        result = apply(after, context.companyId, execution.intent, draftGroups);
      } catch (error) {
        // Local domain assertions are definitive rejections, not uncertain network outcomes.
        if (error instanceof DomainError) throw new PlanningControllerError(error.message, error.code, 400);
        throw error;
      }
      if (result.refetch)
        for (const [id, group] of draftGroups) if (group.companyId === context.companyId) draftGroups.delete(id);
      company.data = after;
      company.revision += 1;
      company.pendingRefetch = result.refetch;
      groups.clear();
      for (const [id, group] of draftGroups) groups.set(id, group);
      if (result.consumedGroupId) groups.delete(result.consumedGroupId);
      const restorationGroupId = result.replacementGroupId ?? undefined;
      commitments.set(execution.mutationId, {
        companyId: context.companyId,
        revision: company.revision,
        ...(restorationGroupId ? { restorationGroupId } : {}),
      });
      return {
        status: "committed",
        mutationId: execution.mutationId,
        revision: company.revision,
        restoration: { consumedGroupId: result.consumedGroupId, replacementGroupId: result.replacementGroupId },
        projection: result.refetch
          ? { mode: "refetch", history: "clear" }
          : { mode: "patch", history: "retain", changed: changed(before, after) },
      } as PlanningMutationSuccess;
    },
    async lookup(_context, mutationId) {
      const commitment = commitments.get(mutationId);
      return commitment
        ? {
            status: "committed",
            mutationId,
            revision: commitment.revision,
            ...(commitment.restorationGroupId ? { restorationGroupId: commitment.restorationGroupId } : {}),
          }
        : { status: "unknown", mutationId };
    },
  };
}

/** Server builds use the typed API; demo builds keep changes in page memory. */
export function createStorePlanningTransport(readData: () => AppData): PlanningTransport {
  return isServerConfigured() ? createPlanningTransport() : createVolatilePlanningTransport(readData);
}
