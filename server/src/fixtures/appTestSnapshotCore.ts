/** Project-link fields modeled by server response fixtures. */
export interface ProjectBinding {
  id: string;
  projectId?: string;
}

/** Activity response fields checked by the server snapshot parsers. */
export interface ActivitySnapshot extends ProjectBinding {
  accountId: string;
  createdAt: string;
  kind: string;
  name: string;
  phaseId?: string;
  updatedAt: string;
}

/** Discipline response fields checked by the server snapshot parsers. */
export interface DisciplineSnapshot {
  accountId: string;
  color?: string;
  createdAt: string;
  id: string;
  name: string;
  sortOrder: number;
  updatedAt: string;
}

/** Phase response fields checked by the server snapshot parsers. */
export interface PhaseSnapshot {
  accountId: string;
  createdAt: string;
  id: string;
  name: string;
  projectId: string;
  updatedAt: string;
}

/** Resource response fields checked by the server snapshot parsers, including availability and optional project binding. */
export interface ResourceSnapshot extends ProjectBinding {
  accountId: string;
  avatarUrl?: string;
  color: string;
  createdAt: string;
  disciplineId?: string;
  firstAvailableDate?: string;
  engagement: string;
  employmentType?: string;
  halfDays: number[];
  isFavourite?: boolean;
  kind: string;
  lastAvailableDate?: string;
  name?: string;
  role: string;
  updatedAt: string;
  workingDays: number[];
  workingHoursPerDay: number;
}

/** Allocation response fields checked by the server snapshot parsers. */
export interface AllocationSnapshot {
  accountId: string;
  activityId: string;
  createdAt: string;
  endDate: string;
  hoursPerDay: number;
  id: string;
  ignoreWeekends?: boolean;
  note?: string;
  task?: string;
  projectId?: string;
  resourceId: string;
  seriesId?: string;
  startDate: string;
  status: string;
  updatedAt: string;
}

/** Project response fields checked by the server snapshot parsers, including lifecycle and privacy metadata. */
export interface ProjectSnapshot {
  accountId: string;
  archivedAt?: string;
  clientId: string;
  codeName?: string;
  color: string;
  createdAt: string;
  deletedAt?: string;
  id: string;
  isPrivate?: boolean;
  name: string;
  updatedAt: string;
}

/** Company-closure response fields checked by the server snapshot parsers. */
export interface ClosureSnapshot {
  accountId: string;
  createdAt: string;
  endDate: string;
  id: string;
  name: string;
  startDate: string;
  updatedAt: string;
}

/** Time-off response fields checked by the server snapshot parsers, including the optional confidential note. */
export interface TimeOffSnapshot {
  accountId: string;
  createdAt: string;
  endDate: string;
  id: string;
  note?: string;
  resourceId: string;
  startDate: string;
  type: string;
  updatedAt: string;
}

/** Account response fields checked by the server snapshot parsers. */
export interface AccountSnapshot {
  capacityOverviewAccess?: string;
  color: string;
  createdAt: string;
  dateStyle?: string;
  disciplinesEnabled?: boolean;
  externalEnabled?: boolean;
  id: string;
  inlineActivityCreateEnabled?: boolean;
  language?: string;
  name: string;
  placeholdersEnabled?: boolean;
  schedulingMode?: string;
  showTaskFieldInSchedule?: boolean;
  timezone?: string;
  updatedAt: string;
  weekStartsOn?: number;
  workingDays?: number[];
}

/** Import receipt counts and audit-delivery status asserted by server integration tests. */
export interface ImportSummary {
  auditWarning: boolean;
  imported: number;
  maxRecords: number;
  skipped: number;
}

/** Server revision metadata asserted for submitted and implicit batch writes. */
export interface BatchRevisionSnapshot {
  createdAt: string;
  id: string;
  rewrite?: true;
  table: string;
  updatedAt: string;
}

/** Lifecycle archive outcome asserted for a batch operation. */
export interface BatchArchiveSnapshot {
  archived: boolean;
  id: string;
  table: string;
}

/** Atomic batch receipt shape asserted by server integration tests. */
export interface BatchReceipt {
  applied: number;
  archives: BatchArchiveSnapshot[];
  auditWarning: boolean;
  changed: number;
  ok: boolean;
  revisions: BatchRevisionSnapshot[];
  superseded?: boolean;
}

/** Revision metadata for an allocation rewritten by an activity change. */
export interface RewrittenAllocationSnapshot {
  createdAt: string;
  id: string;
  updatedAt: string;
}

/** Activity write response with revisions needed to reconcile rewritten allocations. */
export interface ActivityWriteResponse extends ActivitySnapshot {
  rewrittenAllocations: RewrittenAllocationSnapshot[];
}

/** Client response fields checked by the server snapshot parsers, including the built-in and privacy flags. */
export interface ClientSnapshot {
  accountId: string;
  archivedAt?: string;
  builtin?: boolean;
  codeName?: string;
  color: string;
  createdAt: string;
  deletedAt?: string;
  id: string;
  isPrivate?: boolean;
  name: string;
  updatedAt: string;
}

/** Client write-response shape shared with the validated client snapshot. */
export type ClientResponse = ClientSnapshot;

/** Parsed application-state response used by server integration assertions. */
export interface ValidatedStateResponse {
  accounts: AccountSnapshot[];
  activities: ActivitySnapshot[];
  allocations: AllocationSnapshot[];
  clients: ClientSnapshot[];
  closures: ClosureSnapshot[];
  disciplines: DisciplineSnapshot[];
  phases: PhaseSnapshot[];
  projects: ProjectSnapshot[];
  resources: ResourceSnapshot[];
  timeOff: TimeOffSnapshot[];
}

/**
 * Requires the named field to be a string and includes its context in any error.
 */
export function readRequiredString(value: Record<string, unknown>, key: string, context: string): string {
  const field = value[key];
  if (typeof field !== "string") throw new Error(`Expected ${context} ${key} to be a string.`);
  return field;
}

/**
 * Requires the named field to be a number and includes its context in any error.
 */
export function readRequiredNumber(value: Record<string, unknown>, key: string, context: string): number {
  const field = value[key];
  if (typeof field !== "number") throw new Error(`Expected ${context} ${key} to be a number.`);
  return field;
}

/**
 * Returns `undefined` when absent and rejects a present non-string field.
 */
export function readOptionalString(value: Record<string, unknown>, key: string, context: string): string | undefined {
  if (!(key in value)) return undefined;
  return readRequiredString(value, key, context);
}

/**
 * Returns `undefined` when absent and rejects a present non-boolean field.
 */
export function readOptionalBoolean(value: Record<string, unknown>, key: string, context: string): boolean | undefined {
  if (!(key in value)) return undefined;
  const field = value[key];
  if (typeof field !== "boolean") throw new Error(`Expected ${context} ${key} to be boolean.`);
  return field;
}

/**
 * Requires the named field to be a boolean and includes its context in any error.
 */
export function readRequiredBoolean(value: Record<string, unknown>, key: string, context: string): boolean {
  const field = value[key];
  if (typeof field !== "boolean") throw new Error(`Expected ${context} ${key} to be boolean.`);
  return field;
}

/**
 * Returns `undefined` when absent and rejects a present non-number field.
 */
export function readOptionalNumber(value: Record<string, unknown>, key: string, context: string): number | undefined {
  if (!(key in value)) return undefined;
  return readRequiredNumber(value, key, context);
}

/**
 * Requires the named field to be an array containing only numbers.
 */
export function readNumberArray(value: Record<string, unknown>, key: string, context: string): number[] {
  const field = value[key];
  if (!Array.isArray(field) || !field.every((item): item is number => typeof item === "number")) {
    throw new Error(`Expected ${context} ${key} to contain numbers.`);
  }
  return field;
}

/**
 * Returns `undefined` when absent and rejects an array containing non-number values.
 */
export function readOptionalNumberArray(
  value: Record<string, unknown>,
  key: string,
  context: string,
): number[] | undefined {
  if (!(key in value)) return undefined;
  return readNumberArray(value, key, context);
}

/**
 * Rejects response objects containing fields not declared by the expected snapshot model.
 */
export function assertModeledKeys(value: Record<string, unknown>, keys: readonly string[], context: string): void {
  const unexpectedKey = Object.keys(value).find((key) => !keys.includes(key));
  if (unexpectedKey) throw new Error(`Expected ${context} to omit unexpected key ${unexpectedKey}.`);
}

/**
 * Requires the named response field to be an array.
 */
export function readStateArray(value: Record<string, unknown>, key: string): unknown[] {
  if (!(key in value) || !Array.isArray(value[key])) {
    throw new Error(`Expected the state response to contain a ${key} array.`);
  }
  return value[key];
}
