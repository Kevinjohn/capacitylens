import type { FastifyInstance } from "fastify";
import { createApp, type AppOptions } from "../app";
import { createAuthFromEnvironment, runAuthMigrations, type Auth } from "../auth";
import { openDb, type Db } from "../db";
import { PASSWORD_ENV } from "../testHelpers/passwordAuth";
import type { registerServerFixtureCleanup } from "../testHelpers/registerServerFixtureCleanup";

/** Every createApp option except the auth pair this fixture derives from `env`. */
export type AppWithAuthOptions = Omit<AppOptions, "authMode" | "auth"> & {
  /** Environment for createAuthFromEnvironment; defaults to PASSWORD_ENV. */
  env?: Parameters<typeof createAuthFromEnvironment>[1];
  /** Cleanup registry of a suite that closes its fixtures after each test; omit to leave them open. */
  fixtures?: ReturnType<typeof registerServerFixtureCleanup>;
};

/** Narrow the configured auth instance, failing the fixture when the environment disabled auth. */
export function parseConfiguredAuth(auth: Auth | null): Auth {
  if (auth === null) throw new Error("Expected authentication to be configured.");
  return auth;
}

/** Build an in-memory database and an auth-enabled app, with the auth schema migrated. */
export async function appWithAuth(options: AppWithAuthOptions = {}): Promise<{ app: FastifyInstance; db: Db }> {
  const { env = PASSWORD_ENV, fixtures, ...appOptions } = options;
  const opened = openDb(":memory:");
  const db = fixtures ? fixtures.trackDb(opened) : opened;
  const { mode, auth } = createAuthFromEnvironment(db, env);
  const configuredAuth = parseConfiguredAuth(auth);
  await runAuthMigrations(configuredAuth);
  const app = createApp(db, { ...appOptions, authMode: mode, auth: configuredAuth });
  return { app: fixtures ? fixtures.trackApp(app) : app, db };
}
