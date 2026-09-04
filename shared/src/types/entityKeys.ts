import type { AppData } from "./entities";

/** Fixed capacity of a resource weekday marked as a full day. */
export const FULL_DAY_HOURS = 8;

/** Every logical AppData table, independent of persistence implementation. Keep this list in
 * dependency-neutral shape order; use APP_DATA_WRITE_ORDER when parent/child ordering matters. */
export const APP_DATA_KEYS = [
  "accounts",
  "disciplines",
  "resources",
  "clients",
  "projects",
  "phases",
  "activities",
  "allocations",
  "timeOff",
  "closures",
] as const satisfies readonly (keyof AppData)[];

export type AppDataKey = (typeof APP_DATA_KEYS)[number];

type MissingAppDataKey = Exclude<keyof AppData, AppDataKey>;
const appDataKeysAreComplete: MissingAppDataKey extends never ? true : never = true;
void appDataKeysAreComplete;

/** The AppData arrays holding account-scoped entities (everything except `accounts`). */
export type ScopedEntityKey = Exclude<AppDataKey, "accounts">;

export const SCOPED_KEYS = [
  "disciplines",
  "resources",
  "clients",
  "projects",
  "phases",
  "activities",
  "allocations",
  "timeOff",
  "closures",
] as const satisfies readonly ScopedEntityKey[];

type MissingScopedEntityKey = Exclude<ScopedEntityKey, (typeof SCOPED_KEYS)[number]>;
const scopedEntityKeysAreComplete: MissingScopedEntityKey extends never ? true : never = true;
void scopedEntityKeysAreComplete;

/** Parent-before-child order for writes; reverse it for child-before-parent deletion. This is a
 * domain relationship graph shared by the browser diff engine and SQLite adapter, not SQL DDL. */
export const APP_DATA_WRITE_ORDER = [
  "accounts",
  "clients",
  "disciplines",
  "projects",
  "phases",
  "resources",
  "activities",
  "allocations",
  "timeOff",
  "closures",
] as const satisfies readonly AppDataKey[];

/** Scoped subset of APP_DATA_WRITE_ORDER, retained as a named value because scope membership and
 * dependency order are different concepts (SCOPED_KEYS intentionally carries no ordering promise). */
export const SCOPED_WRITE_ORDER = [
  "clients",
  "disciplines",
  "projects",
  "phases",
  "resources",
  "activities",
  "allocations",
  "timeOff",
  "closures",
] as const satisfies readonly ScopedEntityKey[];

type MissingAppDataWriteKey = Exclude<AppDataKey, (typeof APP_DATA_WRITE_ORDER)[number]>;
const appDataWriteOrderIsComplete: MissingAppDataWriteKey extends never ? true : never = true;
void appDataWriteOrderIsComplete;

type MissingScopedWriteKey = Exclude<ScopedEntityKey, (typeof SCOPED_WRITE_ORDER)[number]>;
const scopedWriteOrderIsComplete: MissingScopedWriteKey extends never ? true : never = true;
void scopedWriteOrderIsComplete;

/** Upper bound for hours/day on a resource or allocation — a day can't hold more than
 *  24h. The single source of truth for the clamp applied on import, at the store write
 *  boundary, and after a drag-resize rescale. */
export const MAX_HOURS_PER_DAY = 24;
