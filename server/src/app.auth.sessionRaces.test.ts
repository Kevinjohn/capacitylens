import { describe, it, expect, vi } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createApp } from "./app";
import { openDb } from "./db";
import {
  createAuthFromEnvironment,
  enforceSessionActivity,
  runAuthMigrations,
  SESSION_INACTIVITY_TTL_SECONDS,
} from "./auth";
import { buildApplicationSessionHandle } from "./accounts/buildApplicationSessionHandle";
import { call, PASSWORD_ENV } from "./testHelpers";

/** Collapse a response's Set-Cookie header(s) into one request Cookie header. */
function headerValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (value === undefined) return [];
  return [value];
}

// This suite keeps its own cookie reader rather than testHelpers' readCookies. readCookies models
// a browser cookie jar: it de-duplicates by name and drops expired cookies. This one reports every
// Set-Cookie the server actually sent. The difference is load-bearing in app.auth.bootstrap.test.ts,
// whose assertions require that a rejected sign-up set no session cookie at all — a cleared cookie
// must still be visible to fail them. Kept in every file of the suite so the reader is consistent.
function cookiesOf(res: LightMyRequestResponse): string {
  const raw = res.headers["set-cookie"];
  return headerValues(raw)
    .map((c) => String(c).split(";")[0])
    .join("; ");
}

const TS = "2026-01-01T00:00:00.000Z";

// P3.1/P3.2/P3.5 (flag CAPACITYLENS_AUTH → opts.authMode/auth). The load-bearing assertion set:
// OFF is byte-for-byte today (the whole existing app.test.ts suite already enforces that
// by running unchanged — these tests add the /api/auth/me surface and the absence of the
// Better Auth routes); password gates every data route on a real session; sso issues a
// provider redirect; any misconfiguration refuses to boot via AuthConfigError.

function parseConfiguredAuth(auth: ReturnType<typeof createAuthFromEnvironment>["auth"]) {
  if (auth === null) throw new Error("Expected authentication to be configured.");
  return auth;
}

async function appWithAuth(env: Record<string, string>): Promise<FastifyInstance> {
  const db = openDb(":memory:");
  const { mode, auth } = createAuthFromEnvironment(db, env);
  await runAuthMigrations(parseConfiguredAuth(auth));
  return createApp(db, { authMode: mode, auth });
}

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

describe("CAPACITYLENS_AUTH password", () => {
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

describe("CAPACITYLENS_AUTH password", () => {
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

describe("CAPACITYLENS_AUTH password", () => {
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

describe("CAPACITYLENS_AUTH password", () => {
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

describe("CAPACITYLENS_AUTH password", () => {
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

describe("CAPACITYLENS_AUTH password", () => {
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

describe("CAPACITYLENS_AUTH password", () => {
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

describe("CAPACITYLENS_AUTH password", () => {
  it("sign-out invalidates the session again", async () => {
    const app = await appWithAuth(PASSWORD_ENV);
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

describe("CAPACITYLENS_AUTH password", () => {
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

describe("CAPACITYLENS_AUTH password", () => {
  it("propagates sign-out cookie clearing through the neutral account route", async () => {
    const app = await appWithAuth(PASSWORD_ENV);
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
