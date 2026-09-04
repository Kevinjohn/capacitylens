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
import type { ColumnSpec, TableSpec } from "../tables";
// Type-level exhaustiveness guard for a table's column list: every key of the
// entity type must appear exactly once, and every listed name must be a valid key.
// Usage: `_checkColumns<Account>(COLS_accounts)` — fails to compile the moment a
// field is added to the entity type but omitted from the column spec (or vice versa).
type CheckColumns<E, Cols extends readonly ColumnSpec[]> =
  // Forward: every listed name must be a key of E
  Cols[number]["name"] extends keyof E
    ? // Reverse: every key of E must be covered by the listed names
      Exclude<keyof E, Cols[number]["name"]> extends never
      ? true
      : never
    : never;

// One check-variable per table. Type is `true` when the columns match the entity
// perfectly; `never` (compile error) when they drift.
/* eslint-disable @typescript-eslint/no-unused-vars */
declare const _checkAccounts: CheckColumns<Account, typeof COLS_accounts>;
declare const _checkClients: CheckColumns<Client, typeof COLS_clients>;
declare const _checkDisciplines: CheckColumns<Discipline, typeof COLS_disciplines>;
declare const _checkProjects: CheckColumns<Project, typeof COLS_projects>;
declare const _checkPhases: CheckColumns<Phase, typeof COLS_phases>;
declare const _checkResources: CheckColumns<Resource, typeof COLS_resources>;
declare const _checkActivities: CheckColumns<Activity, typeof COLS_activities>;
declare const _checkAllocations: CheckColumns<Allocation, typeof COLS_allocations>;
declare const _checkTimeOff: CheckColumns<TimeOff, typeof COLS_timeOff>;
declare const _checkClosures: CheckColumns<Closure, typeof COLS_closures>;
/* eslint-enable @typescript-eslint/no-unused-vars */

const META = [{ name: "createdAt" }, { name: "updatedAt" }] as const;

const COLS_accounts = [
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
  ...META,
] as const satisfies ColumnSpec[];

const COLS_clients = [
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

const COLS_disciplines = [
  { name: "id" },
  { name: "accountId" },
  { name: "name" },
  { name: "color", optional: true },
  { name: "sortOrder", sqlType: "INTEGER" },
  ...META,
] as const satisfies ColumnSpec[];

const COLS_projects = [
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

const COLS_phases = [
  { name: "id" },
  { name: "accountId" },
  { name: "name" },
  { name: "projectId" },
  ...META,
] as const satisfies ColumnSpec[];

const COLS_resources = [
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
  // Lifecycle timestamps (P2.1) — plain TEXT, absent → NULL → omitted on read. Inert plumbing today.
  { name: "archivedAt", optional: true },
  { name: "deletedAt", optional: true },
  ...META,
] as const satisfies ColumnSpec[];

const COLS_activities = [
  { name: "id" },
  { name: "accountId" },
  { name: "name" },
  { name: "kind" },
  { name: "projectId", optional: true },
  { name: "phaseId", optional: true },
  ...META,
] as const satisfies ColumnSpec[];

const COLS_allocations = [
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
  // JSON so node:sqlite (which can't bind a raw boolean) round-trips it as
  // "true"/"false"; absent → NULL → omitted on read, matching the client object.
  { name: "ignoreWeekends", json: true, optional: true },
  { name: "seriesId", optional: true },
  ...META,
] as const satisfies ColumnSpec[];

const COLS_timeOff = [
  { name: "id" },
  { name: "accountId" },
  { name: "resourceId" },
  { name: "startDate" },
  { name: "endDate" },
  { name: "type" },
  { name: "note", optional: true },
  ...META,
] as const satisfies ColumnSpec[];

const COLS_closures = [
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
    columns: COLS_accounts,
  },
  clients: {
    key: "clients",
    columns: COLS_clients,
  },
  disciplines: {
    key: "disciplines",
    columns: COLS_disciplines,
  },
  projects: {
    key: "projects",
    columns: COLS_projects,
  },
  phases: {
    key: "phases",
    columns: COLS_phases,
  },
  resources: {
    key: "resources",
    columns: COLS_resources,
  },
  activities: {
    key: "activities",
    columns: COLS_activities,
  },
  allocations: {
    key: "allocations",
    columns: COLS_allocations,
  },
  timeOff: {
    key: "timeOff",
    columns: COLS_timeOff,
  },
  closures: {
    key: "closures",
    columns: COLS_closures,
  },
} satisfies Record<AppDataKey, TableSpec>;
