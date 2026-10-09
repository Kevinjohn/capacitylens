import { describe, it, expect, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app";
import { openDb } from "./db";
import { createAuthFromEnvironment, runAuthMigrations } from "./auth";
import { call, PASSWORD_ENV } from "./testHelpers/passwordAuth";
import { registerServerFixtureCleanup } from "./testHelpers/registerServerFixtureCleanup";

// Better Auth reads NODE_ENV once at import and enables its limiter only in production.
vi.hoisted(() => {
  process.env.NODE_ENV = "production";
});

// Better Auth allows 3 sign-in attempts per 10 s per client in production. The client is the
// address the server resolves, never a raw client-supplied X-Forwarded-For. The library's buckets
// are module-wide, so each test uses its own addresses.
const { trackApp, trackDb } = registerServerFixtureCleanup();

type AppWithCredentialLimitOptions = { trustProxyHeaders: boolean };
async function appWithCredentialLimit({ trustProxyHeaders }: AppWithCredentialLimitOptions): Promise<FastifyInstance> {
  const db = trackDb(openDb(":memory:"));
  const { mode, auth } = createAuthFromEnvironment(db, PASSWORD_ENV);
  if (!auth) throw new Error("Expected authentication to be configured.");
  await runAuthMigrations(auth);
  return trackApp(createApp(db, { authMode: mode, auth, trustProxyHeaders }));
}

const signIn = (app: FastifyInstance, remoteAddress: string, headers: Record<string, string> = {}) =>
  call(app, {
    method: "POST",
    url: "/api/auth/sign-in/email",
    remoteAddress,
    headers,
    payload: { email: "diana.prince@example.test", password: "not-the-password-0123" },
  }).then((response) => response.statusCode);

describe("credential rate limit client identity", () => {
  it("gives each client its own sign-in bucket", async () => {
    const app = await appWithCredentialLimit({ trustProxyHeaders: false });
    for (let attempt = 0; attempt < 3; attempt++) expect(await signIn(app, "192.0.2.1")).toBe(401);
    expect(await signIn(app, "192.0.2.1")).toBe(429);
    expect(await signIn(app, "192.0.2.2")).toBe(401);
  });

  it.each([
    ["x-forwarded-for", "192.0.2.3"],
    ["x-capacitylens-client-ip", "192.0.2.4"],
  ])("ignores a client-supplied %s when proxy headers are not trusted", async (header, socketAddress) => {
    const app = await appWithCredentialLimit({ trustProxyHeaders: false });
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await signIn(app, socketAddress, { [header]: `198.51.100.${attempt}` })).toBe(401);
    }
    expect(await signIn(app, socketAddress, { [header]: "198.51.100.3" })).toBe(429);
  });

  it("keys on the forwarded client when proxy headers are trusted", async () => {
    const app = await appWithCredentialLimit({ trustProxyHeaders: true });
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await signIn(app, "127.0.0.1", { "x-forwarded-for": "203.0.113.1" })).toBe(401);
    }
    expect(await signIn(app, "127.0.0.1", { "x-forwarded-for": "203.0.113.1" })).toBe(429);
    expect(await signIn(app, "127.0.0.1", { "x-forwarded-for": "203.0.113.2" })).toBe(401);
  });
});
