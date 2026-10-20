import { expect } from "@playwright/test";
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seed } from "@capacitylens/shared/data/seed";
import type { AppData } from "@capacitylens/shared/types/entities";
import { ports } from "../scripts/ports.mjs";
import { serverTestApiOrigin } from "../scripts/playwrightRunMode.mjs";

export const DB_BOOTSTRAP_ADMIN = { email: "admin@admin.admin", password: "auth-e2e-password-2026" };

const DB_API = serverTestApiOrigin(ports().dbApi);
const DB_E2E_DATABASE = fileURLToPath(new URL("../apps/backend/.e2e.db", import.meta.url));
const TABLES = {
  accounts: "accounts",
  clients: "clients",
  disciplines: "disciplines",
  projects: "projects",
  phases: "phases",
  resources: "resources",
  activities: "activities",
  allocations: "allocations",
  timeOff: "time_off",
  closures: "closures",
} as const;
const RESET_ORDER = Object.values(TABLES).reverse();
const REQUIRED_TABLES = [
  ...Object.values(TABLES),
  "users",
  "memberships",
  "adonis_sessions",
  "audit_entries",
  "account_member_resources",
] as const;
const JSON_COLUMNS = {
  accounts: new Set([
    "weekStartsOn",
    "workingDays",
    "disciplinesEnabled",
    "placeholdersEnabled",
    "externalEnabled",
    "inlineActivityCreateEnabled",
    "showTaskFieldInSchedule",
    "capacityOverviewAccess",
  ]),
  clients: new Set(["isPrivate", "builtin"]),
  disciplines: new Set<string>(),
  projects: new Set(["isPrivate"]),
  phases: new Set<string>(),
  resources: new Set(["workingDays", "halfDays", "isFavourite"]),
  activities: new Set<string>(),
  allocations: new Set(["ignoreWeekends"]),
  time_off: new Set<string>(),
  closures: new Set<string>(),
} satisfies Record<(typeof TABLES)[keyof typeof TABLES], Set<string>>;

type CookieState = Awaited<ReturnType<APIRequestContext["storageState"]>>["cookies"];
type BrowserCookie = Parameters<BrowserContext["addCookies"]>[0][number];
type SqliteValue = null | string | number | bigint | Uint8Array;

/** Maps cookies from an already authenticated DB request context to the browser app origin. */
export async function dbBrowserSessionCookies(
  request: APIRequestContext,
  configuredBaseUrl: unknown,
): Promise<BrowserCookie[]> {
  if (typeof configuredBaseUrl !== "string") throw new Error("The DB-backed project must define its base URL.");
  const appOrigin = new URL(configuredBaseUrl).origin;
  const { cookies } = await request.storageState();
  return cookies.map((cookie) => toAppOriginCookie(cookie, appOrigin));
}

/** Creates one legitimate bootstrap session in the per-test request context. */
export async function signInDbBootstrap(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${DB_API}/api/auth/sign-in`, { data: DB_BOOTSTRAP_ADMIN });
  expect(response.ok(), "the seeded DB E2E administrator must sign in").toBeTruthy();
}

function toAppOriginCookie(cookie: CookieState[number], appOrigin: string): BrowserCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    url: appOrigin,
    expires: cookie.expires,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
  } as BrowserCookie;
}

/** Resets only disposable product rows, keeping the real seeded identity and native session. */
export function resetDbE2EProductData(withSeed: boolean): void {
  const db = openDbE2EDatabase();
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const foreignKeys = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    if (foreignKeys.foreign_keys !== 1) throw new Error("DB E2E reset requires SQLite foreign keys.");
    const principal = db
      .prepare("SELECT id FROM users WHERE lower(email) = ?")
      .get(DB_BOOTSTRAP_ADMIN.email.toLowerCase()) as { id: string } | undefined;
    if (!principal) throw new Error("The seeded DB E2E administrator is missing.");

    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DELETE FROM audit_entries");
      for (const table of RESET_ORDER) db.exec(`DELETE FROM ${table}`);
      // This product-owned association has no foreign keys, so it must be cleared explicitly.
      db.exec("DELETE FROM account_member_resources");
      if (withSeed) insertSeedData(db, principal.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

function openDbE2EDatabase(): DatabaseSync {
  if (!existsSync(DB_E2E_DATABASE))
    throw new Error("The disposable DB E2E database is unavailable; start the DB E2E server first.");
  const db = new DatabaseSync(DB_E2E_DATABASE);
  try {
    const main = db
      .prepare("PRAGMA database_list")
      .all()
      .find((item) => item.name === "main") as { file: string } | undefined;
    if (
      !main ||
      resolve(main.file) !== resolve(DB_E2E_DATABASE) ||
      realpathSync(DB_E2E_DATABASE) !== resolve(DB_E2E_DATABASE)
    )
      throw new Error("DB E2E fixtures may only access apps/backend/.e2e.db.");

    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
        ({ name }) => name,
      ),
    );
    if (REQUIRED_TABLES.some((table) => !tables.has(table)))
      throw new Error("The database does not match the DB E2E schema.");
    db.exec("PRAGMA busy_timeout = 5000");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function insertSeedData(db: DatabaseSync, ownerId: string): void {
  const seeded = seed();
  const accountId = seeded.accounts[0]?.id;
  if (!accountId) throw new Error("The shared seed must contain its primary company.");
  const rows = Object.fromEntries(
    Object.entries(seeded).map(([key, entities]) => {
      const companyEntities = entities as Array<{ id: string; accountId?: string }>;
      return [
        key,
        key === "accounts"
          ? companyEntities.filter((entity) => entity.id === accountId)
          : companyEntities.filter((entity) => entity.accountId === accountId),
      ];
    }),
  ) as unknown as Record<keyof AppData, Array<Record<string, unknown>>>;

  for (const [key, table] of Object.entries(TABLES)) {
    const entities = rows[key as keyof AppData];
    for (const entity of entities) insertProductRow(db, table, entity);
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO memberships (id, account_id, user_id, role, status, created_at, updated_at)
     VALUES (?, ?, ?, 'owner', 'active', ?, ?)`,
  ).run("db-e2e-owner-membership", accountId, ownerId, now, now);
}

function insertProductRow(db: DatabaseSync, table: string, row: Record<string, unknown>): void {
  const tableColumns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>;
  const columns = new Map(tableColumns.map((column) => [column.name, column]));
  const values = new Map<string, SqliteValue>();
  for (const [key, rawValue] of Object.entries(row)) {
    const column = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    if (!columns.has(column)) throw new Error(`The DB E2E ${table} schema is missing ${column}.`);
    const value = toSqliteValue(rawValue, JSON_COLUMNS[table as keyof typeof JSON_COLUMNS].has(key));
    values.set(column, value);
  }
  for (const column of tableColumns) {
    if (column.notnull === 1 && column.pk === 0 && column.dflt_value === null && !values.has(column.name))
      throw new Error(`The DB E2E seed does not provide required ${table}.${column.name}.`);
  }

  const names = [...values.keys()];
  const placeholders = names.map(() => "?").join(", ");
  db.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${placeholders})`).run(...values.values());
}

function toSqliteValue(value: unknown, json: boolean): SqliteValue {
  if (value === undefined || value === null) return null;
  if (json) return JSON.stringify(value);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    value instanceof Uint8Array
  )
    return value;
  throw new Error("The shared E2E seed contains an unsupported SQLite value.");
}
