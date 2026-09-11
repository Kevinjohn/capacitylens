import type {
  Account,
  Activity,
  Allocation,
  AppDataKey,
  Client,
  Closure,
  Discipline,
  Phase,
  Project,
  Resource,
  TimeOff,
} from "@capacitylens/shared/types/entities";
import type { ColumnSpec, TableSpec } from "./tableSpecs";
// Coverage and uniqueness are separate proofs: a union of names loses duplicates.
// Return false on drift; never would satisfy Assert<T extends true> and hide it.
type UniqueColumns<Cols extends readonly ColumnSpec[]> = Cols extends readonly [
  infer First extends ColumnSpec,
  ...infer Rest extends readonly ColumnSpec[],
]
  ? First["name"] extends Rest[number]["name"]
    ? false
    : UniqueColumns<Rest>
  : true;

type CheckColumns<E, Cols extends readonly ColumnSpec[]> = Cols[number]["name"] extends keyof E
  ? Exclude<keyof E, Cols[number]["name"]> extends never
    ? UniqueColumns<Cols>
    : false
  : false;
type Assert<T extends true> = T;

// Each real table instantiates the constraint, so missing, extra or duplicate
// names fail type-checking without adding runtime schema checks.
/* eslint-disable @typescript-eslint/no-unused-vars */
declare const _checkAccounts: Assert<CheckColumns<Account, typeof accountsColumns>>;
declare const _checkClients: Assert<CheckColumns<Client, typeof clientsColumns>>;
declare const _checkDisciplines: Assert<CheckColumns<Discipline, typeof disciplinesColumns>>;
declare const _checkProjects: Assert<CheckColumns<Project, typeof projectsColumns>>;
declare const _checkPhases: Assert<CheckColumns<Phase, typeof phasesColumns>>;
declare const _checkResources: Assert<CheckColumns<Resource, typeof resourcesColumns>>;
declare const _checkActivities: Assert<CheckColumns<Activity, typeof activitiesColumns>>;
declare const _checkAllocations: Assert<CheckColumns<Allocation, typeof allocationsColumns>>;
declare const _checkTimeOff: Assert<CheckColumns<TimeOff, typeof timeOffColumns>>;
declare const _checkClosures: Assert<CheckColumns<Closure, typeof closuresColumns>>;
/* eslint-enable @typescript-eslint/no-unused-vars */

const META = [{ name: "createdAt" }, { name: "updatedAt" }] as const;

const accountsColumns = [
  { name: "id" },
  { name: "name" },
  { name: "color" },
  { name: "schedulingMode", optional: true },
  { name: "timezone", optional: true },
  { name: "weekStartsOn", json: true, optional: true },
  { name: "workingDays", json: true, optional: true },
  { name: "language", optional: true },
  { name: "disciplinesEnabled", json: true, optional: true },
  { name: "groupResourcesByEngagement", json: true, optional: true },
  { name: "placeholdersEnabled", json: true, optional: true },
  { name: "externalEnabled", json: true, optional: true },
  { name: "internalColourMode", optional: true },
  // Optional schedule view prefs (default true — shown/enabled). JSON so node:sqlite round-trips the
  // boolean as "true"/"false"; absent → NULL → omitted on read, matching the client object.
  { name: "showInternalProjects", json: true, optional: true },
  { name: "showInternalActivities", json: true, optional: true },
  { name: "inlineActivityCreateEnabled", json: true, optional: true },
  { name: "showTaskFieldInSchedule", json: true, optional: true },
  ...META,
] as const satisfies ColumnSpec[];

const clientsColumns = [
  { name: "id" },
  { name: "accountId" },
  { name: "name" },
  { name: "color" },
  // Optional privacy pair: absent = public. Stored code names exclude display quotation marks.
  { name: "isPrivate", json: true, optional: true },
  { name: "codeName", optional: true },
  // JSON so node:sqlite (which can't bind a raw boolean) round-trips it as "true"/"false";
  // absent → NULL → omitted on read, matching the client object. True only for the built-in
  // Internal pseudo-client (one per account).
  { name: "builtin", json: true, optional: true },
  // Lifecycle timestamps (P2.1) — plain TEXT, absent → NULL → omitted on read. Inert plumbing today.
  { name: "archivedAt", optional: true },
  { name: "deletedAt", optional: true },
  ...META,
] as const satisfies ColumnSpec[];

const disciplinesColumns = [
  { name: "id" },
  { name: "accountId" },
  { name: "name" },
  { name: "color", optional: true },
  { name: "sortOrder", sqlType: "INTEGER" },
  ...META,
] as const satisfies ColumnSpec[];

const projectsColumns = [
  { name: "id" },
  { name: "accountId" },
  { name: "name" },
  { name: "clientId" },
  { name: "color" },
  // Optional privacy pair: absent = public. Stored code names exclude display quotation marks.
  { name: "isPrivate", json: true, optional: true },
  { name: "codeName", optional: true },
  // Lifecycle timestamps (P2.1) — plain TEXT, absent → NULL → omitted on read. Inert plumbing today.
  { name: "archivedAt", optional: true },
  { name: "deletedAt", optional: true },
  ...META,
] as const satisfies ColumnSpec[];

const phasesColumns = [
  { name: "id" },
  { name: "accountId" },
  { name: "name" },
  { name: "projectId" },
  ...META,
] as const satisfies ColumnSpec[];

const resourcesColumns = [
  { name: "id" },
  { name: "accountId" },
  { name: "kind" },
  { name: "name", optional: true },
  { name: "role" },
  { name: "disciplineId", optional: true },
  { name: "employmentType" },
  { name: "engagement" },
  { name: "workingHoursPerDay", sqlType: "REAL" },
  { name: "workingDays", json: true },
  { name: "halfDays", json: true },
  { name: "projectId", optional: true },
  { name: "color" },
  { name: "isFavourite", json: true, optional: true },
  { name: "firstAvailableDate", optional: true },
  { name: "lastAvailableDate", optional: true },
  // Lifecycle timestamps (P2.1) — plain TEXT, absent → NULL → omitted on read. Inert plumbing today.
  { name: "archivedAt", optional: true },
  { name: "deletedAt", optional: true },
  ...META,
] as const satisfies ColumnSpec[];

const activitiesColumns = [
  { name: "id" },
  { name: "accountId" },
  { name: "name" },
  { name: "kind" },
  { name: "projectId", optional: true },
  { name: "phaseId", optional: true },
  { name: "archivedAt", optional: true },
  { name: "deletedAt", optional: true },
  ...META,
] as const satisfies ColumnSpec[];

const allocationsColumns = [
  { name: "id" },
  { name: "accountId" },
  { name: "resourceId" },
  { name: "activityId" },
  { name: "projectId", optional: true },
  { name: "startDate" },
  { name: "endDate" },
  { name: "hoursPerDay", sqlType: "REAL" },
  { name: "status" },
  { name: "note", optional: true },
  { name: "task", optional: true },
  // JSON so node:sqlite (which can't bind a raw boolean) round-trips it as
  // "true"/"false"; absent → NULL → omitted on read, matching the client object.
  { name: "ignoreWeekends", json: true, optional: true },
  { name: "seriesId", optional: true },
  ...META,
] as const satisfies ColumnSpec[];

const timeOffColumns = [
  { name: "id" },
  { name: "accountId" },
  { name: "resourceId" },
  { name: "startDate" },
  { name: "endDate" },
  { name: "type" },
  { name: "note", optional: true },
  ...META,
] as const satisfies ColumnSpec[];

const closuresColumns = [
  { name: "id" },
  { name: "accountId" },
  { name: "name" },
  { name: "startDate" },
  { name: "endDate" },
  ...META,
] as const satisfies ColumnSpec[];

export const TABLE_DEFINITIONS = {
  accounts: {
    key: "accounts",
    columns: accountsColumns,
  },
  clients: {
    key: "clients",
    columns: clientsColumns,
  },
  disciplines: {
    key: "disciplines",
    columns: disciplinesColumns,
  },
  projects: {
    key: "projects",
    columns: projectsColumns,
  },
  phases: {
    key: "phases",
    columns: phasesColumns,
  },
  resources: {
    key: "resources",
    columns: resourcesColumns,
  },
  activities: {
    key: "activities",
    columns: activitiesColumns,
  },
  allocations: {
    key: "allocations",
    columns: allocationsColumns,
  },
  timeOff: {
    key: "timeOff",
    columns: timeOffColumns,
  },
  closures: {
    key: "closures",
    columns: closuresColumns,
  },
} satisfies Record<AppDataKey, TableSpec>;
