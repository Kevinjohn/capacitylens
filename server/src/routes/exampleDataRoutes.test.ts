import { expect, it } from "vitest";
import { buildExampleCompany } from "@capacitylens/shared/data/exampleCompany";
import { buildInternalClient } from "@capacitylens/shared/data/internalClient";
import { SCOPED_KEYS } from "@capacitylens/shared/types/entities";
import { createApp } from "../app";
import type { AuditEntry, AuditSink } from "../audit";
import { createAuthFromEnvironment, runAuthMigrations } from "../auth";
import { upsertMember } from "../controlTables";
import { insertRow, openDb, type Db } from "../db";
import { PASSWORD_ENV, call, registerServerFixtureCleanup, signUp } from "../testHelpers";

const TS = "2026-01-01T00:00:00.000Z";
const { trackApp, trackDb } = registerServerFixtureCleanup();

function seedCompany(db: Db, id: string, name: string): void {
  db.prepare("INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)").run(
    id,
    name,
    "#2d75da",
    TS,
    TS,
  );
  insertRow(db, "clients", { ...buildInternalClient(id, TS, `internal:${id}`) });
}

function recordingSink() {
  const entries: AuditEntry[] = [];
  const sink: AuditSink = {
    append: (entry) => entries.push(entry) > 0,
    degraded: false,
  };
  return { entries, sink };
}

async function fixture() {
  const db = trackDb(openDb(":memory:"));
  seedCompany(db, "a-studio", "Wayne Enterprises");
  seedCompany(db, "a-loft", "Stark Industries");
  const { mode, auth } = createAuthFromEnvironment(db, PASSWORD_ENV);
  if (!auth) throw new Error("Expected auth configuration.");
  await runAuthMigrations(auth);
  const { entries, sink } = recordingSink();
  const app = trackApp(createApp(db, { authMode: mode, auth, audit: sink }));
  return { app, db, entries };
}

async function member(
  app: Awaited<ReturnType<typeof fixture>>["app"],
  db: Db,
  {
    role,
    email,
    accountId = "a-studio",
  }: { role: "owner" | "admin" | "editor" | "viewer"; email: string; accountId?: string },
) {
  const signedIn = await signUp(app, email);
  upsertMember(db, { accountId, userId: signedIn.userId, role, status: "active", createdAt: TS });
  return signedIn.cookie;
}

const url = (accountId: string) => `/api/accounts/${accountId}/example-data`;
const post = (app: Awaited<ReturnType<typeof fixture>>["app"], accountId: string, cookie?: string) =>
  call(app, { method: "POST", url: url(accountId), ...(cookie ? { headers: { cookie } } : {}) });

function countRows(db: Db, accountId: string): Record<string, number> {
  return Object.fromEntries(
    SCOPED_KEYS.map((table) => [
      table,
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE accountId = ?`).get(accountId) as { n: number }).n,
    ]),
  );
}

it("adds the example company once to an empty company and audits it", async () => {
  const { app, db, entries } = await fixture();
  const owner = await member(app, db, { role: "owner", email: "bruce.wayne@example.test" });
  const before = countRows(db, "a-studio");
  const expected = buildExampleCompany({ accountId: "a-studio", referenceDate: "2031-09-17" });

  const added = await post(app, "a-studio", owner);
  expect(added.statusCode).toBe(201);

  const after = countRows(db, "a-studio");
  for (const table of SCOPED_KEYS) {
    const rows = (expected as Record<string, unknown[] | undefined>)[table] ?? [];
    expect(after[table], table).toBe((before[table] ?? 0) + rows.length);
  }
  expect(added.json()).toEqual({ added: Object.values(expected).reduce((sum, rows) => sum + rows.length, 0) });
  // Only the built-in Internal client existed beforehand, and it does not make a company non-empty.
  expect(before["clients"]).toBe(1);
  expect(countRows(db, "a-loft")["resources"]).toBe(0);
  expect(entries.filter((entry) => "action" in entry && entry.action === "exampleData")).toMatchObject([
    { accountId: "a-studio", entity: "account", id: "a-studio" },
  ]);

  const second = await post(app, "a-studio", owner);
  expect(second.statusCode).toBe(409);
  expect(second.json()).toMatchObject({ code: "EXAMPLE_DATA_COMPANY_NOT_EMPTY" });
  expect(countRows(db, "a-studio")).toEqual(after);
});

it("lets an admin add example data and refuses editors, viewers, non-members and anonymous callers", async () => {
  const { app, db } = await fixture();
  const editor = await member(app, db, { role: "editor", email: "dick.grayson@example.test" });
  const viewer = await member(app, db, { role: "viewer", email: "barbara.gordon@example.test" });
  const stranger = await member(app, db, { role: "owner", email: "tony.stark@example.test", accountId: "a-loft" });
  const admin = await member(app, db, { role: "admin", email: "alfred.pennyworth@example.test" });
  const empty = countRows(db, "a-studio");

  expect((await post(app, "a-studio", editor)).statusCode).toBe(403);
  expect((await post(app, "a-studio", viewer)).statusCode).toBe(403);
  expect((await post(app, "a-studio", stranger)).statusCode).toBe(403);
  expect((await post(app, "a-studio")).statusCode).toBe(401);
  expect(countRows(db, "a-studio")).toEqual(empty);

  expect((await post(app, "a-studio", admin)).statusCode).toBe(201);
  expect(countRows(db, "a-studio")["resources"]).toBe(2);
});

function exampleRow<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("The generated example set must contain this row.");
  return row;
}

it.each(["resources", "clients", "projects"] as const)(
  "refuses a company that already has %s and adds nothing",
  async (table) => {
    const { app, db } = await fixture();
    const owner = await member(app, db, { role: "owner", email: "bruce.wayne@example.test" });
    const own = buildExampleCompany({ accountId: "a-studio", referenceDate: "2031-09-17" });
    // One row of the named kind, with whatever it needs so the database accepts it.
    if (table !== "resources") insertRow(db, "clients", { ...exampleRow(own.clients) });
    if (table === "projects") insertRow(db, "projects", { ...exampleRow(own.projects) });
    if (table === "resources") insertRow(db, "resources", { ...exampleRow(own.resources), disciplineId: undefined });
    const before = countRows(db, "a-studio");

    const refused = await post(app, "a-studio", owner);
    expect(refused.statusCode).toBe(409);
    expect(countRows(db, "a-studio")).toEqual(before);
  },
);

it("answers 404 for an unknown company when authentication is off", async () => {
  const db = trackDb(openDb(":memory:"));
  seedCompany(db, "a-studio", "Wayne Enterprises");
  const app = trackApp(createApp(db));
  expect((await post(app, "a-missing")).statusCode).toBe(404);
  expect((await post(app, "a-studio")).statusCode).toBe(201);
  expect(countRows(db, "a-studio")["resources"]).toBe(2);
  expect((await post(app, "a-studio")).statusCode).toBe(409);
});
