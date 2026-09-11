export interface ProjectBinding {
  id: string;
  projectId?: string;
}

export interface ActivitySnapshot extends ProjectBinding {
  accountId: string;
  createdAt: string;
  kind: string;
  name: string;
  phaseId?: string;
  updatedAt: string;
}

export interface DisciplineSnapshot {
  accountId: string;
  color?: string;
  createdAt: string;
  id: string;
  name: string;
  sortOrder: number;
  updatedAt: string;
}

export interface PhaseSnapshot {
  accountId: string;
  createdAt: string;
  id: string;
  name: string;
  projectId: string;
  updatedAt: string;
}

export interface ResourceSnapshot extends ProjectBinding {
  accountId: string;
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

export interface ClosureSnapshot {
  accountId: string;
  createdAt: string;
  endDate: string;
  id: string;
  name: string;
  startDate: string;
  updatedAt: string;
}

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

export interface AccountSnapshot {
  capacityOverviewAccess?: string;
  color: string;
  createdAt: string;
  disciplinesEnabled?: boolean;
  externalEnabled?: boolean;
  groupResourcesByEngagement?: boolean;
  id: string;
  inlineActivityCreateEnabled?: boolean;
  internalColourMode?: string;
  language?: string;
  name: string;
  placeholdersEnabled?: boolean;
  schedulingMode?: string;
  showInternalActivities?: boolean;
  showInternalProjects?: boolean;
  showTaskFieldInSchedule?: boolean;
  timezone?: string;
  updatedAt: string;
  weekStartsOn?: number;
  workingDays?: number[];
}

export interface ImportSummary {
  auditWarning: boolean;
  imported: number;
  maxRecords: number;
  skipped: number;
}

export interface BatchRevisionSnapshot {
  createdAt: string;
  id: string;
  rewrite?: true;
  table: string;
  updatedAt: string;
}

export interface BatchArchiveSnapshot {
  archived: boolean;
  id: string;
  table: string;
}

export interface BatchReceipt {
  applied: number;
  archives: BatchArchiveSnapshot[];
  auditWarning: boolean;
  changed: number;
  ok: boolean;
  revisions: BatchRevisionSnapshot[];
  superseded?: boolean;
}

export interface RewrittenAllocationSnapshot {
  createdAt: string;
  id: string;
  updatedAt: string;
}

export interface ActivityWriteResponse extends ActivitySnapshot {
  rewrittenAllocations: RewrittenAllocationSnapshot[];
}

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

export type ClientResponse = ClientSnapshot;

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

export function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readRequiredString(value: Record<string, unknown>, key: string, context: string): string {
  const field = value[key];
  if (typeof field !== "string") throw new Error(`Expected ${context} ${key} to be a string.`);
  return field;
}

export function readRequiredNumber(value: Record<string, unknown>, key: string, context: string): number {
  const field = value[key];
  if (typeof field !== "number") throw new Error(`Expected ${context} ${key} to be a number.`);
  return field;
}

export function readOptionalString(value: Record<string, unknown>, key: string, context: string): string | undefined {
  if (!(key in value)) return undefined;
  return readRequiredString(value, key, context);
}

export function readOptionalBoolean(value: Record<string, unknown>, key: string, context: string): boolean | undefined {
  if (!(key in value)) return undefined;
  const field = value[key];
  if (typeof field !== "boolean") throw new Error(`Expected ${context} ${key} to be boolean.`);
  return field;
}

export function readRequiredBoolean(value: Record<string, unknown>, key: string, context: string): boolean {
  const field = value[key];
  if (typeof field !== "boolean") throw new Error(`Expected ${context} ${key} to be boolean.`);
  return field;
}

export function readOptionalNumber(value: Record<string, unknown>, key: string, context: string): number | undefined {
  if (!(key in value)) return undefined;
  return readRequiredNumber(value, key, context);
}

export function readNumberArray(value: Record<string, unknown>, key: string, context: string): number[] {
  const field = value[key];
  if (!Array.isArray(field) || !field.every((item): item is number => typeof item === "number")) {
    throw new Error(`Expected ${context} ${key} to contain numbers.`);
  }
  return field;
}

export function readOptionalNumberArray(
  value: Record<string, unknown>,
  key: string,
  context: string,
): number[] | undefined {
  if (!(key in value)) return undefined;
  return readNumberArray(value, key, context);
}

export function requireModeledKeys(value: Record<string, unknown>, keys: readonly string[], context: string): void {
  const unexpectedKey = Object.keys(value).find((key) => !keys.includes(key));
  if (unexpectedKey) throw new Error(`Expected ${context} to omit unexpected key ${unexpectedKey}.`);
}

export function readStateArray(value: Record<string, unknown>, key: string): unknown[] {
  if (!(key in value) || !Array.isArray(value[key])) {
    throw new Error(`Expected the state response to contain a ${key} array.`);
  }
  return value[key];
}
