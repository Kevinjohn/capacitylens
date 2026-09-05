import { describe, expect, it } from "vitest";
import { KNOWN_COLUMNS, KNOWN_TABLES } from "../scripts/rehearse-migrations";
import { authFromEnv, runAuthMigrations } from "./auth";
import { openDb } from "./db";
import { PASSWORD_ENV } from "./testHelpers";

describe("rehearsal schema coverage", () => {
  it("classifies every live app and auth column while allowing historical ledger entries", async () => {
    const db = openDb(":memory:");
    try {
      const { auth } = authFromEnv(db, { ...PASSWORD_ENV, CAPACITYLENS_REQUIRE_MFA: "1" });
      await runAuthMigrations(auth!);
      const tables = db
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>;
      expect(tables.map(({ name }) => name)).toEqual(
        expect.arrayContaining(["user", "account", "session", "verification", "twoFactor"]),
      );
      const missing: string[] = [];
      for (const { name } of tables) {
        if (!KNOWN_TABLES.has(name)) missing.push(name);
        const columns = db.prepare(`PRAGMA table_info("${name.replaceAll('"', '""')}")`).all() as Array<{
          name: string;
        }>;
        for (const column of columns) {
          if (!KNOWN_COLUMNS[name]?.has(column.name)) missing.push(`${name}.${column.name}`);
        }
      }
      expect(missing).toEqual([]);
    } finally {
      db.close();
    }
  });
});
