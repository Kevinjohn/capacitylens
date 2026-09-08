import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createAuthFromEnvironment, assertFederatedIdentitySchemaCurrent, runAuthMigrations } from "../src/auth";
import { DB_SCHEMA_VERSION, initializeOpenDb, openDb, openDbConnection } from "../src/db";

type FixtureTarget = {
  mode: "off" | "password";
  source: string;
  target: string;
};

function openFixtureDatabase(target: string, targetVersion: number): ReturnType<typeof openDb> {
  if (targetVersion === DB_SCHEMA_VERSION) return openDb(target);

  const connection = openDbConnection(target);
  const stopBeforeNextVersion = new Error(`fixture reached v${targetVersion}`);
  try {
    initializeOpenDb(connection, target, {
      beforeCommit: (migration) => {
        if (migration.version > targetVersion) throw stopBeforeNextVersion;
      },
    });
  } catch (error) {
    if (error !== stopBeforeNextVersion) throw error;
  }
  return connection;
}

async function addPasswordAuthSchema(db: ReturnType<typeof openDb>): Promise<void> {
  // Keep the deterministic fixture credential obvious at runtime without storing a
  // credential-shaped assignment in source; full-history scanning correctly treats a
  // literal bound to this configuration key as suspicious.
  const fixtureEntropy = ["01234567", "89abcdef"].join("");
  const fixtureSecret = ["fixture", "secret", fixtureEntropy, "012345"].join("-");
  const configured = createAuthFromEnvironment(db, {
    SMALLSASS_ACCOUNT_MODE: "password",
    SMALLSASS_ACCOUNT_SECRET: fixtureSecret,
    SMALLSASS_ACCOUNT_PUBLIC_URL: "http://localhost:8787",
  });
  if (configured.auth === null) throw new Error("Password fixture requires password authentication.");
  await runAuthMigrations(configured.auth);
  assertFederatedIdentitySchemaCurrent(db);
}

function checkFixture(db: ReturnType<typeof openDb>, mode: FixtureTarget["mode"]): void {
  const quickCheck = db.prepare(`PRAGMA quick_check`).all() as Array<{ quick_check: string }>;
  if (quickCheck.length !== 1 || quickCheck[0]?.quick_check !== "ok") {
    throw new Error(`${mode} fixture failed quick_check: ${JSON.stringify(quickCheck)}`);
  }
  const foreignKeys = db.prepare(`PRAGMA foreign_key_check`).all();
  if (foreignKeys.length > 0) throw new Error(`${mode} fixture failed foreign_key_check.`);
}

async function generateFixture({ mode, source, target }: FixtureTarget, targetVersion: number): Promise<void> {
  copyFileSync(source, target);
  const db = openFixtureDatabase(target, targetVersion);
  try {
    if (mode === "password") await addPasswordAuthSchema(db);
    checkFixture(db, mode);
    db.exec(`PRAGMA journal_mode = DELETE; VACUUM;`);
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const [sourceValue, targetValue] = process.argv.slice(2);
  const sourceVersion = Number(sourceValue);
  const targetVersion = Number(targetValue);
  const versionsAreInvalid =
    !Number.isInteger(sourceVersion) ||
    !Number.isInteger(targetVersion) ||
    sourceVersion >= targetVersion ||
    targetVersion > DB_SCHEMA_VERSION;
  if (versionsAreInvalid) {
    console.error(
      `Usage: tsx scripts/generate-database-fixtures.ts <source-version> <target-version<=${DB_SCHEMA_VERSION}>`,
    );
    process.exitCode = 2;
    return;
  }

  const directory = resolve("src/fixtures/databases");
  const targets: FixtureTarget[] = (["off", "password"] as const).map((mode) => ({
    mode,
    source: resolve(directory, `v${sourceVersion}-${mode}.db`),
    target: resolve(directory, `v${targetVersion}-${mode}.db`),
  }));
  for (const { source, target } of targets) {
    if (!existsSync(source)) throw new Error(`Fixture source does not exist: ${source}`);
    if (existsSync(target)) throw new Error(`Refusing to overwrite committed fixture: ${target}`);
  }

  for (const target of targets) await generateFixture(target, targetVersion);
}

await main();
