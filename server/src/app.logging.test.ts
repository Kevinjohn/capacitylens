import { describe, it, expect, vi, afterEach } from "vitest";
import { buildApp, requestLoggerOptions } from "./app";
import { openDb } from "./db";
import { authFromEnv, runAuthMigrations } from "./auth";
import { call, PASSWORD_ENV, signUp } from "./testHelpers";

// P1.3 (flag CAPACITYLENS_LOG → opts.log): ON gives structured per-request JSON via Fastify's
// bundled pino and routes the 500-path error through the request logger; OFF is byte-for-
// byte today's behaviour (no request logs, bare console.error on 500s). The logStream
// seam exists only so these tests can read the JSON lines instead of stdout.

function capture() {
  const lines: string[] = [];
  return { lines, stream: { write: (msg: string) => void lines.push(msg) } };
}

afterEach(() => vi.restoreAllMocks());

describe("CAPACITYLENS_LOG on", () => {
  it("emits method/path/status request-completion JSON lines", async () => {
    const { lines, stream } = capture();
    const app = buildApp(openDb(":memory:"), { log: true, logStream: stream });
    await app.inject({ method: "GET", url: "/api/health" });
    const out = lines.join("");
    expect(out).toContain('"url":"/api/health"');
    expect(out).toContain('"method":"GET"');
    expect(out).toContain('"statusCode":200');
    expect(out).toContain("request completed");
  });

  it("routes the 500-path error through the request logger, not console.error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { lines, stream } = capture();
    const db = openDb(":memory:");
    const app = buildApp(db, { log: true, logStream: stream });
    db.close(); // /api/state now throws → the 500 redaction funnel
    const res = await app.inject({ method: "GET", url: "/api/state" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Internal server error" }); // body still generic
    expect(consoleError).not.toHaveBeenCalled();
    expect(lines.join("")).toContain('"level":50'); // pino error line carries the real cause
  });
});

describe("CAPACITYLENS_LOG redaction (P0.5.5)", () => {
  it("wires remove:true to every secret header path before serializers run", () => {
    expect(requestLoggerOptions().redact).toEqual({
      paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
      remove: true,
    });
  });

  // End-to-end: a real request carrying secret headers. They don't appear because default
  // serializers don't log headers — this guards against a future serializer change leaking them.
  it("keeps authorization/cookie headers off the request log lines", async () => {
    const { lines, stream } = capture();
    const app = buildApp(openDb(":memory:"), { log: true, logStream: stream });
    await app.inject({
      method: "GET",
      url: "/api/health",
      headers: {
        authorization: "Bearer SENTINEL_AUTH",
        cookie: "session=SENTINEL_C",
      },
    });
    const out = lines.join("");
    expect(out).toContain('"url":"/api/health"'); // the request was logged
    expect(out).not.toContain("SENTINEL_AUTH");
    expect(out).not.toContain("SENTINEL_C");
  });
});

describe("CAPACITYLENS_LOG invite-token URL redaction (P1.9)", () => {
  // The invite-accept URL carries the bearer token in its PATH; pino logs req.url verbatim, so a
  // serializer must mask the :token segment before it reaches stdout. Other URLs stay intact.
  it("rewrites /api/invites/<token>/accept to /api/invites/[redacted]/accept", async () => {
    const { lines, stream } = capture();
    const app = buildApp(openDb(":memory:"), { log: true, logStream: stream });
    const TOKEN = "SENTINEL_LIVE_INVITE_TOKEN";
    // The token is unknown → the route 404s, but the request IS logged with the URL we care about.
    const res = await app.inject({
      method: "POST",
      url: `/api/invites/${TOKEN}/accept`,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    const out = lines.join("");
    expect(out).toContain('"url":"/api/invites/[redacted]/accept"'); // masked path logged
    expect(out).not.toContain(TOKEN); // the live token never reaches the log
  });

  it.each(["preview", "signup"])("also redacts the token from the %s URL", async (operation) => {
    const { lines, stream } = capture();
    const app = buildApp(openDb(":memory:"), {
      log: true,
      logStream: stream,
    });
    const TOKEN = `SENTINEL_${operation.toUpperCase()}_INVITE_TOKEN`;
    await app.inject({
      method: operation === "preview" ? "GET" : "POST",
      url: `/api/invites/${TOKEN}/${operation}`,
      ...(operation === "signup" ? { payload: {} } : {}),
    });
    const out = lines.join("");
    expect(out).toContain(`"url":"/api/invites/[redacted]/${operation}"`);
    expect(out).not.toContain(TOKEN);
  });

  it("also redacts token paths in structured security events", async () => {
    const db = openDb(":memory:");
    const { mode, auth } = authFromEnv(db, PASSWORD_ENV);
    await runAuthMigrations(auth!);
    const events: Array<Record<string, unknown>> = [];
    const app = buildApp(db, {
      authMode: mode,
      auth,
      securityLog: (event) => events.push(event),
    });
    const TOKEN = "SENTINEL_SECURITY_EVENT_INVITE_TOKEN";

    const res = await app.inject({
      method: "POST",
      url: `/api/invites/${TOKEN}/accept`,
    });
    expect(res.statusCode).toBe(401);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "authentication_required",
        path: "/api/invites/[redacted]/accept",
      }),
    );
    expect(JSON.stringify(events)).not.toContain(TOKEN);
  });

  it("redacts secret query parameters while preserving ordinary query state", async () => {
    const { lines, stream } = capture();
    const app = buildApp(openDb(":memory:"), { log: true, logStream: stream });
    const CODE = "SENTINEL_CALLBACK_CODE";
    const STATE = "SENTINEL_CALLBACK_STATE";

    await app.inject({
      method: "GET",
      url: `/api/health?code=${CODE}&state=${STATE}&keep=1`,
    });

    const out = lines.join("");
    expect(out).toContain('"url":"/api/health?code=%5Bredacted%5D&state=%5Bredacted%5D&keep=1"');
    expect(out).not.toContain(CODE);
    expect(out).not.toContain(STATE);
  });

  it("leaves every other URL intact", async () => {
    const { lines, stream } = capture();
    const app = buildApp(openDb(":memory:"), { log: true, logStream: stream });
    await app.inject({ method: "GET", url: "/api/health" });
    expect(lines.join("")).toContain('"url":"/api/health"');
  });
});

describe("security-event client identity", () => {
  it.each([
    [true, "198.51.100.7"],
    [false, "127.0.0.1"],
  ])("uses the forwarded client only when proxy headers are trusted (%s)", async (trustProxyHeaders, expectedIp) => {
    const db = openDb(":memory:");
    const { mode, auth } = authFromEnv(db, PASSWORD_ENV);
    await runAuthMigrations(auth!);
    const events: Array<Record<string, unknown>> = [];
    const app = buildApp(db, {
      authMode: mode,
      auth,
      trustProxyHeaders,
      securityLog: (event) => events.push(event),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/state",
      headers: { "x-forwarded-for": "198.51.100.7, 127.0.0.1" },
    });

    expect(response.statusCode).toBe(401);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "authentication_required",
        remoteIp: expectedIp,
      }),
    );
  });
});

describe("CAPACITYLENS_LOG off (default)", () => {
  it("emits no request logs at all", async () => {
    const { lines, stream } = capture();
    const app = buildApp(openDb(":memory:"), { logStream: stream }); // stream ignored when off
    await app.inject({ method: "GET", url: "/api/health" });
    expect(lines).toEqual([]);
  });

  it("keeps the 500-path on console.error (today, byte for byte)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { lines, stream } = capture();
    const db = openDb(":memory:");
    const app = buildApp(db, { logStream: stream });
    db.close();
    const res = await app.inject({ method: "GET", url: "/api/state" });
    expect(res.statusCode).toBe(500);
    expect(consoleError).toHaveBeenCalled();
    expect(lines).toEqual([]);
  });
});

describe("authentication security events", () => {
  it("attributes verified sign-in and sign-out sessions without trusting failed credentials", async () => {
    const db = openDb(":memory:");
    const { mode, auth } = authFromEnv(db, PASSWORD_ENV);
    await runAuthMigrations(auth!);
    const events: Array<Record<string, unknown>> = [];
    const app = buildApp(db, {
      authMode: mode,
      auth,
      securityLog: (event) => events.push(event),
    });
    const email = "security-events@capacitylens.dev";
    const { cookie, userId } = await signUp(app, email);

    const signOut = await call(app, {
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { cookie },
      payload: {},
    });
    expect(signOut.statusCode).toBe(200);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "authentication",
        path: "/api/auth/sign-out",
        outcome: "success",
        userId,
      }),
    );

    const failed = await call(app, {
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email, password: "wrong-password-123456" },
    });
    expect(failed.statusCode).toBe(401);
    expect(events.at(-1)).toMatchObject({
      event: "authentication",
      path: "/api/auth/sign-in/email",
      outcome: "failure",
    });
    expect(events.at(-1)).not.toHaveProperty("userId");
    expect(JSON.stringify(events.at(-1))).not.toContain(email);
    expect(JSON.stringify(events.at(-1))).not.toContain("wrong-password-123456");

    const signIn = await call(app, {
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email, password: "password-123456" },
    });
    expect(signIn.statusCode).toBe(200);
    expect(events.at(-1)).toMatchObject({
      event: "authentication",
      path: "/api/auth/sign-in/email",
      outcome: "success",
      userId,
    });
  });
});
