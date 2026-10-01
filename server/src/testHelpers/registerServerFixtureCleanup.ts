import { afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "../db";

/** Own every Fastify/SQLite fixture created by one test file and close it after each test. */
export function registerServerFixtureCleanup(): {
  trackApp: <T extends FastifyInstance>(app: T) => T;
  trackDb: <T extends Db>(db: T) => T;
} {
  const apps = new Set<FastifyInstance>();
  const databases = new Set<Db>();

  afterEach(async () => {
    const errors: unknown[] = [];
    for (const app of apps) {
      try {
        await app.close();
      } catch (error) {
        errors.push(error);
      }
    }
    for (const db of databases) {
      if (!db.isOpen) continue;
      try {
        db.close();
      } catch (error) {
        errors.push(error);
      }
    }
    apps.clear();
    databases.clear();
    if (errors.length > 0) {
      throw new AggregateError(errors, "Server fixture cleanup failed.");
    }
  });

  return {
    trackApp: <T extends FastifyInstance>(app: T): T => {
      apps.add(app);
      return app;
    },
    trackDb: <T extends Db>(db: T): T => {
      databases.add(db);
      return db;
    },
  };
}
