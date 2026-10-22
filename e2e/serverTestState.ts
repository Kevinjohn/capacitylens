import { expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { ports } from "../scripts/ports.mjs";
import { serverTestApiOrigin } from "../scripts/playwrightRunMode.mjs";
import { DatabaseSync } from "node:sqlite";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Database-backed specs reset server state between tests, then exercise the app through
// real UI flows. Their normal app fixture contains one company; server tests seed legacy
// multi-company data directly when they need tenant-isolation cases.

/** Resolves the server API origin for the claimed local lane. */
export const API = serverTestApiOrigin(ports().dbApi);

const databasePath = fileURLToPath(new URL("../apps/backend/.e2e.db", import.meta.url));
const backendDirectory = fileURLToPath(new URL("../apps/backend/", import.meta.url));

type ResetServerOptions = { request: APIRequestContext; withSeed?: boolean };
function seedDisposableDatabase() {
  if (!existsSync(databasePath) || realpathSync(databasePath) !== resolve(databasePath))
    throw new Error("The disposable database-backed fixture is unavailable.");
  const seeded = spawnSync(process.execPath, ["ace.js", "db:seed", "--files=database/seeders/main_seeder.ts"], {
    cwd: backendDirectory,
    env: {
      ...process.env,
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: String(ports().dbApi),
      LOG_LEVEL: "error",
      APP_KEY: "capacitylens-e2e-key-0123456789abcdef",
      APP_URL: API,
      SESSION_DRIVER: "database",
      CAPACITYLENS_DB: ".e2e.db",
      CAPACITYLENS_MODE: "password-only",
      CAPACITYLENS_SECRET: "capacitylens-auth-e2e-secret-0123456789abcdef",
      CAPACITYLENS_PUBLIC_URL: API,
      CAPACITYLENS_CREATE_ADMIN_ADMIN: "1",
      CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: "auth-e2e-password-2026",
    },
    encoding: "utf8",
  });
  if (seeded.status !== 0) throw new Error(`Disposable fixture seed failed: ${seeded.stderr || seeded.stdout}`);
}

/** Restores the fixture identity after a company-erasure test deletes its last member. */
export function ensureDbFixtureAdministrator() {
  if (!existsSync(databasePath)) throw new Error("The disposable database-backed fixture is unavailable.");
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    if (db.prepare("SELECT id FROM users WHERE email = ?").get("admin@admin.admin")) return;
  } finally {
    db.close();
  }
  seedDisposableDatabase();
}

/** Resets only the disposable SQLite fixture; product HTTP reset stays forbidden. */
export async function resetServer({ withSeed = true }: ResetServerOptions): Promise<void> {
  seedDisposableDatabase();
  const db = new DatabaseSync(databasePath);
  try {
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
        ({ name }) => name,
      ),
    );
    if (["users", "memberships", "accounts", "adonis_sessions"].some((table) => !tables.has(table)))
      throw new Error("The disposable database does not match the authenticated schema.");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("BEGIN IMMEDIATE");
    try {
      if (withSeed) db.prepare("DELETE FROM accounts WHERE id <> ?").run("a-studio");
      else db.exec("DELETE FROM accounts");
      if (withSeed) {
        const admin = db.prepare("SELECT id FROM users WHERE email = ?").get("admin@admin.admin") as
          { id: string } | undefined;
        if (!admin) throw new Error("The disposable administrator is unavailable.");
        const now = new Date().toISOString();
        db.prepare(
          "INSERT INTO memberships (id, account_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, ?, 'owner', 'active', ?, ?)",
        ).run(crypto.randomUUID(), "a-studio", admin.id, now, now);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

/** Returns the server tables used by database-backed assertions. */
export async function serverState(request: APIRequestContext): Promise<
  Record<
    string,
    Array<{
      id: string;
      name?: string;
      archivedAt?: string;
      deletedAt?: string;
      language?: string;
      seriesId?: string;
      engagement?: "studio" | "supplementary";
      halfDays?: number[];
      avatarUrl?: string;
    }>
  >
> {
  const res = await request.get(`${API}/api/state`);
  expect(res.ok()).toBeTruthy();
  return res.json();
}

/** Returns the named table’s rows without changing the server state.
 * @throws Error when the response omits the table; callers must not treat an omitted table as empty.
 */
export function requireStateRows<T extends Awaited<ReturnType<typeof serverState>>>(
  state: T,
  table: keyof T,
): T[keyof T] {
  const rows = state[table];
  if (rows === undefined) throw new Error(`Server state must include the ${String(table)} table`);
  return rows;
}
