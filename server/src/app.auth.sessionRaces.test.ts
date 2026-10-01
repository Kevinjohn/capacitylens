import { describe, it, expect, vi } from "vitest";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "./app";
import { openDb } from "./db";
import {
  createAuthFromEnvironment,
  enforceSessionActivity,
  runAuthMigrations,
  SESSION_INACTIVITY_TTL_SECONDS,
} from "./auth";
import { buildApplicationSessionHandle } from "./accounts/buildApplicationSessionHandle";
import { call, PASSWORD_ENV, cookiesOf } from "./testHelpers/passwordAuth";
import { appWithAuth, parseConfiguredAuth } from "./fixtures/appWithAuth";
import { tx } from "./txn";
import { authTransactionGateFor, type GateSlot } from "./authTransactionGate";

const TS = "2026-01-01T00:00:00.000Z";

// P3.1/P3.2/P3.5 (flag CAPACITYLENS_MODE → opts.authMode/auth). The load-bearing assertion set:
// OFF is byte-for-byte today (the whole existing app.test.ts suite already enforces that
// by running unchanged — these tests add the /api/auth/me surface and the absence of the
// Better Auth routes); password gates every data route on a real session; sso issues a
// provider redirect; any misconfiguration refuses to boot via AuthConfigError.

async function createSessionManagementFixture() {
  const db = openDb(":memory:");
  const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
  await runAuthMigrations(parseConfiguredAuth(configured.auth));
  const app = createApp(db, {
    authMode: configured.mode,
    auth: configured.auth,
  });
  const signUp = await call(app, {
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: {
      email: "sessions@capacitylens.dev",
      password: "password-123456",
      name: "Sessions",
    },
  });
  const raw = db.prepare(`SELECT id, token, userId FROM session`).get() as {
    id: string;
    token: string;
    userId: string;
  };
  const staleToken = "stale-session-bearer-token";
  const staleHandle = buildApplicationSessionHandle("capacitylens", staleToken);
  db.prepare(
    `
      INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
    `,
  ).run(
    "stale-session-row",
    "2026-01-01T12:00:00.000Z",
    staleToken,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
    raw.userId,
  );
  db.prepare(
    `
      INSERT INTO account_session_assurance (sessionId, principalId, assurance, providerId, createdAt)
      VALUES (?, ?, 'password', NULL, ?)
    `,
  ).run(staleHandle, raw.userId, "2026-01-01T00:00:00.000Z");
  return { app, cookie: cookiesOf(signUp), db, raw, staleHandle };
}

function createLifecycleRaceFixture(next: string | null) {
  const raw = openDb(":memory:");
  raw.exec(`CREATE TABLE session (token TEXT PRIMARY KEY, updatedAt date)`);
  const now = Date.parse("2026-07-31T09:00:00.000Z");
  const expired = new Date(now - (SESSION_INACTIVITY_TTL_SECONDS + 1) * 1_000).toISOString();
  const token = "lifecycle-reread";
  raw.prepare(`INSERT INTO session (token, updatedAt) VALUES (?, ?)`).run(token, expired);
  const deletions = { count: 0 };
  const raced = new Proxy(raw, {
    get(target, property) {
      if (property === "exec") {
        return (sql: string) => {
          if (sql === "BEGIN IMMEDIATE") {
            // Another connection's update is visible by the time the writer reservation is acquired.
            if (next === null) target.prepare(`DELETE FROM session WHERE token = ?`).run(token);
            else target.prepare(`UPDATE session SET updatedAt = ? WHERE token = ?`).run(next, token);
          }
          return target.exec(sql);
        };
      }
      if (property === "prepare") {
        return (sql: string) => {
          const statement = target.prepare(sql);
          if (sql === "DELETE FROM session WHERE token = ?") {
            return new Proxy(statement, {
              get(statementTarget, statementProperty) {
                if (statementProperty === "run") {
                  return (sessionToken: string) => {
                    deletions.count += 1;
                    return statementTarget.run(sessionToken);
                  };
                }
                const value = Reflect.get(statementTarget, statementProperty, statementTarget) as unknown;
                return typeof value === "function" ? value.bind(statementTarget) : value;
              },
            });
          }
          return statement;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { deletions, expired, now, raced, raw, token };
}
void createLifecycleRaceFixture;

describe("CAPACITYLENS_MODE password", () => {
  it("does not delete a session touched after an expired request resolved its stale snapshot", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
    await runAuthMigrations(parseConfiguredAuth(configured.auth));
    const app = createApp(db, { authMode: configured.mode, auth: configured.auth });
    await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email: "stale-delete@capacitylens.dev", password: "password-123456", name: "Stale" },
    });
    const stored = db.prepare(`SELECT token FROM session`).get() as { token: string };
    const stale = Date.now() - (SESSION_INACTIVITY_TTL_SECONDS + 1) * 1000;
    const newer = new Date(Date.now()).toISOString();
    db.prepare(`UPDATE session SET updatedAt = ? WHERE token = ?`).run(newer, stored.token);

    const resolved = await enforceSessionActivity({ session: { token: stored.token, updatedAt: new Date(stale) } }, db);

    expect(resolved).not.toBeNull();
    expect(db.prepare(`SELECT updatedAt FROM session WHERE token = ?`).get(stored.token)).toEqual({ updatedAt: newer });
  });
});

describe("CAPACITYLENS_MODE password", () => {
  it("does not move a concurrent newer session touch backward", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
    await runAuthMigrations(parseConfiguredAuth(configured.auth));
    const app = createApp(db, { authMode: configured.mode, auth: configured.auth });
    await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email: "monotonic-touch@capacitylens.dev", password: "password-123456", name: "Touch" },
    });
    const stored = db.prepare(`SELECT token FROM session`).get() as { token: string };
    const stale = Date.now() - 2 * 60 * 1000;
    const newer = new Date(Date.now() + 1_000).toISOString();
    db.prepare(`UPDATE session SET updatedAt = ? WHERE token = ?`).run(newer, stored.token);

    await enforceSessionActivity({ session: { token: stored.token, updatedAt: new Date(stale) } }, db);

    expect(db.prepare(`SELECT updatedAt FROM session WHERE token = ?`).get(stored.token)).toEqual({ updatedAt: newer });
  });
});

describe("CAPACITYLENS_MODE password", () => {
  it("destroys a session resolved with a non-finite activity timestamp", async () => {
    const db = openDb(":memory:");
    db.exec(`CREATE TABLE session (token TEXT PRIMARY KEY, updatedAt date)`);
    db.prepare(`INSERT INTO session (token, updatedAt) VALUES (?, ?)`).run("invalid-resolved", TS);

    await expect(
      enforceSessionActivity({ session: { token: "invalid-resolved", updatedAt: "not-a-timestamp" } }, db),
    ).resolves.toBeNull();
    expect(db.prepare(`SELECT token FROM session`).all()).toEqual([]);
  });
});

describe("CAPACITYLENS_MODE password", () => {
  it.each([
    ["a vanished row", false],
    ["an unparseable stored timestamp", true],
  ])("fails closed for idle expiry with %s", async (_name, insertMalformed) => {
    const db = openDb(":memory:");
    db.exec(`CREATE TABLE session (token TEXT PRIMARY KEY, updatedAt date)`);
    if (insertMalformed) {
      db.prepare(`INSERT INTO session (token, updatedAt) VALUES (?, ?)`).run("idle-invalid", "not-a-timestamp");
    }
    const expired = Date.now() - (SESSION_INACTIVITY_TTL_SECONDS + 1) * 1_000;

    await expect(
      enforceSessionActivity({ session: { token: "idle-invalid", updatedAt: new Date(expired) } }, db),
    ).resolves.toBeNull();
    expect(db.prepare(`SELECT token FROM session`).all()).toEqual([]);
  });
});

describe("CAPACITYLENS_MODE password", () => {
  it("adopts a concurrent touch when the idle-expiry CAS delete loses", async () => {
    const raw = openDb(":memory:");
    raw.exec(`CREATE TABLE session (token TEXT PRIMARY KEY, updatedAt date)`);
    const expired = new Date(Date.now() - (SESSION_INACTIVITY_TTL_SECONDS + 1) * 1_000).toISOString();
    const winner = new Date().toISOString();
    raw.prepare(`INSERT INTO session (token, updatedAt) VALUES (?, ?)`).run("idle-cas", expired);
    const raced = new Proxy(raw, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            const statement = target.prepare(sql);
            if (/DELETE FROM session WHERE token = \? AND updatedAt = \?/.test(sql)) {
              return new Proxy(statement, {
                get(statementTarget, statementProperty) {
                  if (statementProperty === "run") {
                    return () => {
                      target.prepare(`UPDATE session SET updatedAt = ? WHERE token = ?`).run(winner, "idle-cas");
                      return { changes: 0 };
                    };
                  }
                  const value = Reflect.get(statementTarget, statementProperty, statementTarget) as unknown;
                  return typeof value === "function" ? value.bind(statementTarget) : value;
                },
              });
            }
            return statement;
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as typeof raw;

    const session = { session: { token: "idle-cas", updatedAt: new Date(expired) } };
    await expect(enforceSessionActivity(session, raced)).resolves.toBe(session);
    expect(session.session.updatedAt.getTime()).toBe(Date.parse(winner));
  });

  it.each([
    ["a vanished row", false],
    ["an unparseable stored timestamp", true],
  ])("fails closed on the activity-touch path with %s", async (_name, insertMalformed) => {
    const db = openDb(":memory:");
    db.exec(`CREATE TABLE session (token TEXT PRIMARY KEY, updatedAt date)`);
    if (insertMalformed) {
      db.prepare(`INSERT INTO session (token, updatedAt) VALUES (?, ?)`).run("touch-invalid", "not-a-timestamp");
    }
    const stale = Date.now() - 2 * 60 * 1_000;

    await expect(
      enforceSessionActivity({ session: { token: "touch-invalid", updatedAt: new Date(stale) } }, db),
    ).resolves.toBeNull();
    expect(db.prepare(`SELECT token FROM session`).all()).toEqual([]);
  });
});

describe("CAPACITYLENS_MODE password", () => {
  it("revokes dependent sessions when malformed activity is deleted during a touch", async () => {
    const db = openDb(":memory:");
    const token = "touch-invalid-lifecycle";
    db.exec(`CREATE TABLE session (token TEXT PRIMARY KEY, updatedAt date)`);
    db.prepare(`INSERT INTO session (token, updatedAt) VALUES (?, ?)`).run(token, "not-a-timestamp");
    const prepare = vi.fn((sessionToken: string, reason: "session_expired") => {
      expect(db.isTransaction).toBe(true);
      expect(db.prepare(`SELECT token FROM session WHERE token = ?`).get(token)).toEqual({ token });
      expect(sessionToken).toBe(token);
      expect(reason).toBe("session_expired");
      return ["dependent-session"];
    });
    const commit = vi.fn((sessionHandles: readonly string[]) => {
      expect(db.isTransaction).toBe(false);
      expect(db.prepare(`SELECT token FROM session WHERE token = ?`).get(token)).toBeUndefined();
      expect(sessionHandles).toEqual(["dependent-session"]);
    });
    const stale = Date.now() - 2 * 60 * 1_000;

    await expect(
      enforceSessionActivity({ session: { token, updatedAt: new Date(stale) } }, db, { prepare, commit }),
    ).resolves.toBeNull();
    expect(prepare).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
  });
});

describe("CAPACITYLENS_MODE password", () => {
  it("adopts the winner when the activity-touch CAS loses", async () => {
    const raw = openDb(":memory:");
    raw.exec(`CREATE TABLE session (token TEXT PRIMARY KEY, updatedAt date)`);
    const stale = new Date(Date.now() - 2 * 60 * 1_000).toISOString();
    const winner = new Date(Date.now() + 1_000).toISOString();
    raw.prepare(`INSERT INTO session (token, updatedAt) VALUES (?, ?)`).run("touch-cas", stale);
    const raced = new Proxy(raw, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            const statement = target.prepare(sql);
            if (/UPDATE session SET updatedAt = \? WHERE token = \? AND updatedAt = \?/.test(sql)) {
              return new Proxy(statement, {
                get(statementTarget, statementProperty) {
                  if (statementProperty === "run") {
                    return () => {
                      target.prepare(`UPDATE session SET updatedAt = ? WHERE token = ?`).run(winner, "touch-cas");
                      return { changes: 0 };
                    };
                  }
                  const value = Reflect.get(statementTarget, statementProperty, statementTarget) as unknown;
                  return typeof value === "function" ? value.bind(statementTarget) : value;
                },
              });
            }
            return statement;
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as typeof raw;

    const session = { session: { token: "touch-cas", updatedAt: new Date(stale) } };
    await expect(enforceSessionActivity(session, raced)).resolves.toBe(session);
    expect(session.session.updatedAt.getTime()).toBe(Date.parse(winner));
  });
});

describe("CAPACITYLENS_MODE password", () => {
  it("sign-out invalidates the session again", async () => {
    const { app } = await appWithAuth({ env: PASSWORD_ENV });
    const signUp = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        email: "out@capacitylens.dev",
        password: "password-123456",
        name: "Out",
      },
    });
    const cookie = cookiesOf(signUp);
    const out = await call(app, {
      method: "POST",
      url: "/api/auth/sign-out",
      payload: {},
      headers: { cookie },
    });
    expect(out.statusCode).toBe(200);
    expect(
      (
        await call(app, {
          method: "GET",
          url: "/api/state",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe("CAPACITYLENS_MODE password", () => {
  it("lists and revokes sessions through neutral opaque handles without exposing bearer tokens", async () => {
    const { app, cookie, db, raw, staleHandle } = await createSessionManagementFixture();

    const listed = await call(app, {
      method: "GET",
      url: "/api/account/sessions",
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    const { sessions } = listed.json() as { sessions: Array<{ id: string; current: boolean }> };
    expect(sessions).toHaveLength(1);
    const session = sessions[0];
    if (session === undefined) throw new Error("Expected the current session to be listed.");
    expect(session).toMatchObject({ current: true });
    expect(session.id).not.toBe(raw.id);
    expect(session.id).toBe(buildApplicationSessionHandle("capacitylens", raw.token));
    expect(JSON.stringify(sessions)).not.toContain(raw.token);
    expect(db.prepare(`SELECT 1 FROM session WHERE id = 'stale-session-row'`).get()).toBeUndefined();
    expect(db.prepare(`SELECT 1 FROM account_session_assurance WHERE sessionId = ?`).get(staleHandle)).toBeUndefined();

    const revoked = await call(app, {
      method: "DELETE",
      url: `/api/account/sessions/${session.id}`,
      headers: {
        cookie,
        "idempotency-key": "session-idempotency-0001",
        "x-account-command-id": "session-command-0000001",
      },
    });
    expect(revoked.statusCode).toBe(204);
    expect(revoked.body).toBe("");
    expect(
      (
        await call(app, {
          method: "GET",
          url: "/api/auth/me",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe("CAPACITYLENS_MODE password", () => {
  it("propagates sign-out cookie clearing through the neutral account route", async () => {
    const { app } = await appWithAuth({ env: PASSWORD_ENV });
    const signUp = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        email: "neutral-out@capacitylens.dev",
        password: "password-123456",
        name: "Out",
      },
    });
    const cookie = cookiesOf(signUp);
    const out = await call(app, {
      method: "POST",
      url: "/api/account/sign-out",
      headers: { cookie },
    });
    expect(out.statusCode).toBe(200);
    expect(String(out.headers["set-cookie"])).toMatch(/Max-Age=0|Expires=/i);
    expect(
      (
        await call(app, {
          method: "GET",
          url: "/api/auth/me",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe("CAPACITYLENS_MODE password", () => {
  it("never nests a concurrent write in an in-flight sign-up", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
    await runAuthMigrations(parseConfiguredAuth(configured.auth));
    const app = createApp(db, { authMode: configured.mode, auth: configured.auth });
    db.exec("CREATE TABLE concurrent_writes (turn INTEGER NOT NULL) STRICT");

    const signUpState = { settled: false };
    const signUp = call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email: "diana@capacitylens.dev", password: "password-123456", name: "Diana Prince" },
    }).finally(() => (signUpState.settled = true));
    // Write on every turn the sign-up yields. A write that finds the sign-up's transaction open is
    // refused; every acknowledged write must survive whatever the sign-up does.
    let acknowledged = 0;
    for (let turn = 0; !signUpState.settled; turn++) {
      const write = () => tx(db, () => db.prepare("INSERT INTO concurrent_writes (turn) VALUES (?)").run(turn));
      if (db.isTransaction) expect(write).toThrow(/did not open/);
      else {
        write();
        acknowledged++;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect((await signUp).statusCode).toBe(200);
    expect(acknowledged).toBeGreaterThan(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM user").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM concurrent_writes").get()).toEqual({ count: acknowledged });
  });
});

async function gatedWriteFixture() {
  const db = openDb(":memory:");
  const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
  await runAuthMigrations(parseConfiguredAuth(configured.auth));
  const app = createApp(db, { authMode: configured.mode, auth: configured.auth });
  db.exec("CREATE TABLE concurrent_writes (name TEXT NOT NULL) STRICT");
  app.post("/api/test-concurrent-write", async (request) => {
    const { name } = request.body as { name: string };
    tx(db, () => db.prepare("INSERT INTO concurrent_writes (name) VALUES (?)").run(name));
    return { ok: true };
  });
  const writer = await call(app, {
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { email: "selina@capacitylens.dev", password: "password-123456", name: "Selina Kyle" },
  });
  const write = (name: string) =>
    app.inject({
      method: "POST",
      url: "/api/test-concurrent-write",
      headers: { cookie: cookiesOf(writer) },
      payload: { name },
    });
  const names = () =>
    db
      .prepare("SELECT name FROM concurrent_writes")
      .all()
      .map((row) => row.name);
  return { db, app, write, names, gate: authTransactionGateFor(db) };
}

async function turns(count: number) {
  for (let index = 0; index < count; index++) await new Promise((resolve) => setImmediate(resolve));
}

describe("CAPACITYLENS_MODE password", () => {
  it("holds an API write until a library transaction finishes, then commits it on its own", async () => {
    const { db, write, names, gate } = await gatedWriteFixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const library = gate.runExclusive(async () => {
      db.exec("BEGIN");
      db.prepare("INSERT INTO concurrent_writes (name) VALUES ('library')").run();
      await held;
      db.exec("ROLLBACK");
    });

    let responded = false;
    const pending = write("api").finally(() => (responded = true));
    await turns(20);
    expect(responded).toBe(false);
    release();
    await library;

    expect((await pending).statusCode).toBe(200);
    expect(names()).toEqual(["api"]);
  });
});

describe("CAPACITYLENS_MODE password", () => {
  it("opens Better Auth's sign-up transaction only after in-flight writers finish", async () => {
    const { app, db, gate } = await gatedWriteFixture();
    const writer: GateSlot = { held: false, closed: false };
    await gate.enter(writer);

    let responded = false;
    const signUp = call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email: "barbara@capacitylens.dev", password: "password-123456", name: "Barbara Gordon" },
    }).finally(() => (responded = true));
    // An ungated sign-up finishes well inside this window; a gated one waits for the writer.
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      await turns(1);
      expect(db.isTransaction).toBe(false);
    }
    expect(responded).toBe(false);
    gate.release(writer);

    expect((await signUp).statusCode).toBe(200);
  });
});

describe("CAPACITYLENS_MODE password", () => {
  // The gate finds a request's slot through async context. inject() always keeps that context, so
  // prove it also survives a real socket whose body arrives after the headers.
  it("completes a sign-up whose body arrives after its headers", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
    await runAuthMigrations(parseConfiguredAuth(configured.auth));
    const app = createApp(db, { authMode: configured.mode, auth: configured.auth });
    await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const { port } = app.server.address() as AddressInfo;
      const body = JSON.stringify({
        email: "cassandra@capacitylens.dev",
        password: "password-123456",
        name: "Cassandra Cain",
      });
      const status = await new Promise<number>((resolve, reject) => {
        const request = httpRequest(
          {
            host: "127.0.0.1",
            port,
            method: "POST",
            path: "/api/auth/sign-up/email",
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          },
        );
        request.on("error", reject);
        request.flushHeaders();
        setTimeout(() => request.end(body), 100);
      });
      expect(status).toBe(200);
    } finally {
      await app.close();
    }
  }, 10_000);
});
