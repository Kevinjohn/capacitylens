import { expect, it } from "vitest";
import { createApp } from "./app";
import { createAuthFromEnvironment, runAuthMigrations } from "./auth";
import { upsertMember } from "./controlTables";
import { openDb, type Db } from "./db";
import { PASSWORD_ENV, call, registerServerFixtureCleanup, signUp } from "./testHelpers";

const TS = "2026-01-01T00:00:00.000Z";
const { trackApp, trackDb } = registerServerFixtureCleanup();

async function fixture() {
  const db = trackDb(openDb(":memory:"));
  db.prepare("INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)").run(
    "a-studio",
    "Wayne Enterprises",
    "#3b82f6",
    TS,
    TS,
  );
  db.prepare("INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)").run(
    "a-loft",
    "Stark Industries",
    "#3b82f6",
    TS,
    TS,
  );
  const { mode, auth } = createAuthFromEnvironment(db, PASSWORD_ENV);
  if (!auth) throw new Error("Expected auth configuration.");
  await runAuthMigrations(auth);
  const app = trackApp(createApp(db, { authMode: mode, auth }));
  return { app, db };
}

async function member(
  app: Awaited<ReturnType<typeof fixture>>["app"],
  db: Db,
  { role, email }: { role: "owner" | "admin" | "editor" | "viewer"; email: string },
) {
  const signedIn = await signUp(app, email);
  upsertMember(db, { accountId: "a-studio", userId: signedIn.userId, role, status: "active", createdAt: TS });
  return signedIn.cookie;
}

const url = (accountId: string) => `/api/accounts/${accountId}/getting-started`;

it("is shared with another member and isolated from another company", async () => {
  const { app, db } = await fixture();
  const owner = await member(app, db, { role: "owner", email: "bruce.wayne@example.test" });
  const editor = await member(app, db, { role: "editor", email: "dick.grayson@example.test" });
  const viewer = await member(app, db, { role: "viewer", email: "barbara.gordon@example.test" });
  const ownerId = (
    db.prepare("SELECT userId FROM account_members WHERE accountId = ? AND role = ?").get("a-studio", "owner") as {
      userId: string;
    }
  ).userId;
  upsertMember(db, { accountId: "a-loft", userId: ownerId, role: "owner", status: "active", createdAt: TS });
  expect((await call(app, { method: "GET", url: url("a-studio"), headers: { cookie: owner } })).json()).toEqual({
    dismissed: false,
  });
  const saved = await call(app, {
    method: "PUT",
    url: url("a-studio"),
    headers: { cookie: owner },
    payload: { dismissed: true },
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.json()).toEqual({ dismissed: true });
  expect((await call(app, { method: "GET", url: url("a-studio"), headers: { cookie: editor } })).json()).toEqual({
    dismissed: true,
  });
  expect((await call(app, { method: "GET", url: url("a-studio"), headers: { cookie: viewer } })).json()).toEqual({
    dismissed: true,
  });
  expect((await call(app, { method: "GET", url: url("a-loft"), headers: { cookie: owner } })).json()).toEqual({
    dismissed: false,
  });
  expect((await call(app, { method: "GET", url: url("a-loft"), headers: { cookie: editor } })).statusCode).toBe(403);
  expect(db.prepare("SELECT accountId FROM account_getting_started_dismissals").all()).toEqual([
    { accountId: "a-studio" },
  ]);
  db.prepare("DELETE FROM accounts WHERE id = ?").run("a-studio");
  expect(db.prepare("SELECT accountId FROM account_getting_started_dismissals").all()).toEqual([]);
});

it("allows owner and admin writes but refuses editor and viewer writes", async () => {
  const { app, db } = await fixture();
  for (const [role, email, expected] of [
    ["owner", "bruce.wayne@example.test", 200],
    ["admin", "alfred.pennyworth@example.test", 200],
    ["editor", "dick.grayson@example.test", 403],
    ["viewer", "barbara.gordon@example.test", 403],
  ] as const) {
    const cookie = await member(app, db, { role, email });
    const response = await call(app, {
      method: "PUT",
      url: url("a-studio"),
      headers: { cookie },
      payload: { dismissed: true },
    });
    expect(response.statusCode).toBe(expected);
  }
  expect((await call(app, { method: "PUT", url: url("a-studio"), payload: { dismissed: true } })).statusCode).toBe(401);
});

it("rejects a malformed or reversing write without changing dismissal", async () => {
  const { app, db } = await fixture();
  const owner = await member(app, db, { role: "owner", email: "bruce.wayne@example.test" });
  for (const payload of [{ dismissed: false }, { dismissed: "true" }, {}, { dismissed: true, extra: 1 }]) {
    expect(
      (await call(app, { method: "PUT", url: url("a-studio"), headers: { cookie: owner }, payload })).statusCode,
    ).toBe(400);
  }
  expect((await call(app, { method: "GET", url: url("a-studio"), headers: { cookie: owner } })).json()).toEqual({
    dismissed: false,
  });
});
