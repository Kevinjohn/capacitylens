import { backup, DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { DB_SCHEMA_VERSION, initializeOpenDb, openDb, openDbConnection, planDatabaseMigrations } from "../src/db";
import { writePreMigrationBackup } from "../src/backup";
import { assertMigrationValuesPreserved, captureMigrationValues } from "../src/migrationPreservation";

import { anonymise } from "./rehearse/anonymise";
import {
  readRowCountsByTable,
  readDatabaseDigest,
  checkIntegrity,
  readExpectedPostMigrationRowCounts,
  assertPreserved,
} from "./rehearse/rehearsalChecks";

async function copyDatabaseOnline(sourcePath: string, destinationPath: string): Promise<void> {
  const source = new DatabaseSync(sourcePath, {
    readOnly: true,
    enableForeignKeyConstraints: false,
  });
  try {
    await backup(source, destinationPath);
  } finally {
    source.close();
  }
}

async function expectKilledMigrationRollsBack(path: string, targetVersion: number): Promise<void> {
  const script = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [...process.execArgv, script, "--worker-kill", path, String(targetVersion)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const outcome = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`kill rehearsal worker timed out${stderr ? `: ${stderr}` : ""}`));
    }, 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes("CAPACITYLENS_MIGRATION_READY")) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal });
    });
  });
  if (outcome.signal !== "SIGKILL") {
    throw new Error(`kill rehearsal worker exited unexpectedly (${outcome.code ?? outcome.signal}): ${stderr}`);
  }
  const recovered = new DatabaseSync(path, {
    enableForeignKeyConstraints: false,
  });
  try {
    checkIntegrity(recovered, "process-termination recovery");
    const recoveredVersion = Number(
      (recovered.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    );
    if (recoveredVersion !== targetVersion - 1) {
      throw new Error(
        `process termination reached database v${recoveredVersion}; expected the target v${targetVersion} transaction to roll back to v${targetVersion - 1}`,
      );
    }
    initializeOpenDb(recovered, path);
    checkIntegrity(recovered, "process-termination resumed upgrade");
    if (planDatabaseMigrations(recovered).migrations.length !== 0) {
      throw new Error("process-termination recovery did not complete the remaining migration chain");
    }
  } finally {
    recovered.close();
  }
}

async function runKilledMigrationWorker(path: string, targetVersion: number): Promise<never> {
  const db = openDbConnection(path);
  try {
    initializeOpenDb(db, path, {
      beforeCommit: ({ version }) => {
        if (version !== targetVersion) return;
        writeSync(1, "CAPACITYLENS_MIGRATION_READY\n");
        // Parent sends SIGKILL while the real migration transaction is still open.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      },
    });
    throw new Error("kill rehearsal worker unexpectedly committed");
  } finally {
    // The normal test path is killed while blocked above. Close on every early failure or
    // unexpected commit so a directly-invoked worker never strands a descriptor.
    db.close();
  }
}

interface CliOptions {
  source: string;
  keep: boolean;
}

function parseOptions(args: string[]): CliOptions {
  let source: string | undefined;
  let keep = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--") continue;
    if (args[index] === "--source") {
      source = args[++index];
      if (!source) throw new Error("--source requires a database path");
    } else if (args[index] === "--keep") keep = true;
    else throw new Error(`unknown argument ${JSON.stringify(args[index])}`);
  }
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  return {
    source: source
      ? resolve(invocationDirectory, source)
      : resolve(fileURLToPath(new URL("../src/fixtures/databases/v7-password.db", import.meta.url))),
    keep,
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!existsSync(options.source)) throw new Error(`source database does not exist: ${options.source}`);
  const directory = mkdtempSync(join(tmpdir(), "capacitylens-migration-rehearsal-"));
  try {
    const base = join(directory, "anonymised-source.db");
    await copyDatabaseOnline(options.source, base);
    const sanitising = new DatabaseSync(base, {
      enableForeignKeyConstraints: false,
    });
    let expectedCounts: Record<string, number>;
    let beforeVersion: number;
    let beforeCounts: Record<string, number>;
    let beforeDigest: string;
    let beforeValues: ReturnType<typeof captureMigrationValues>;
    let plan: ReturnType<typeof planDatabaseMigrations>;
    try {
      const sourceVersion = Number(
        (
          sanitising.prepare("PRAGMA user_version").get() as {
            user_version: number;
          }
        ).user_version,
      );
      expectedCounts = readExpectedPostMigrationRowCounts(sanitising, sourceVersion);
      anonymise(sanitising);
      checkIntegrity(sanitising, "anonymised source");
      beforeVersion = Number(
        (
          sanitising.prepare("PRAGMA user_version").get() as {
            user_version: number;
          }
        ).user_version,
      );
      beforeCounts = readRowCountsByTable(sanitising);
      beforeValues = captureMigrationValues(sanitising);
      beforeDigest = readDatabaseDigest(sanitising);
      plan = planDatabaseMigrations(sanitising);
    } finally {
      sanitising.close();
    }
    if (plan.migrations.length === 0) {
      throw new Error(`source is already at database v${DB_SCHEMA_VERSION}; choose an older released database`);
    }

    const happyPath = join(directory, "happy.db");
    copyFileSync(base, happyPath);
    const backups = join(directory, "backups");
    mkdirSync(backups);
    const happy = openDbConnection(happyPath);
    let rollback: string | null;
    try {
      rollback = await writePreMigrationBackup({
        db: happy,
        options: {
          dbPath: happyPath,
          fromVersion: plan.fromVersion,
          toVersion: plan.toVersion,
          dir: backups,
        },
        log: () => {},
      });
      initializeOpenDb(happy, happyPath);
      checkIntegrity(happy, "happy path");
      assertPreserved(beforeCounts, readRowCountsByTable(happy), expectedCounts);
      assertMigrationValuesPreserved(beforeValues, captureMigrationValues(happy), beforeVersion);
    } finally {
      happy.close();
    }
    if (!rollback) throw new Error("happy path did not create a rollback snapshot");

    const rollbackDb = new DatabaseSync(rollback, {
      readOnly: true,
      enableForeignKeyConstraints: false,
    });
    try {
      checkIntegrity(rollbackDb, "rollback snapshot");
      if (readDatabaseDigest(rollbackDb) !== beforeDigest)
        throw new Error("rollback snapshot differs from anonymised source");
    } finally {
      rollbackDb.close();
    }

    const reopened = openDb(happyPath);
    try {
      if (planDatabaseMigrations(reopened).migrations.length !== 0) throw new Error("reopen was not idempotent");
    } finally {
      reopened.close();
    }

    const diskFullPath = join(directory, "disk-full.db");
    copyFileSync(base, diskFullPath);
    const diskFull = openDbConnection(diskFullPath);
    const diskError = Object.assign(new Error("simulated ENOSPC during migration"), { code: "ENOSPC" });
    try {
      let failedAsExpected = false;
      try {
        initializeOpenDb(diskFull, diskFullPath, {
          beforeCommit: () => {
            throw diskError;
          },
        });
      } catch (error) {
        if (error === diskError) failedAsExpected = true;
        else throw error;
      }
      if (!failedAsExpected) throw new Error("simulated disk exhaustion unexpectedly committed");
      checkIntegrity(diskFull, "disk-exhaustion rollback");
      if (readDatabaseDigest(diskFull) !== beforeDigest)
        throw new Error("disk exhaustion left a partially applied migration");
    } finally {
      diskFull.close();
    }

    const killedPath = join(directory, "killed.db");
    copyFileSync(base, killedPath);
    // Kill the LAST pending migration, after every earlier step has committed. This exercises a
    // real mid-chain restart rather than repeatedly killing only the first pending version, then
    // reopens the database and proves the remaining upgrade resumes to completion.
    await expectKilledMigrationRollsBack(killedPath, plan.migrations.at(-1)!.version);

    const totalRows = Object.values(beforeCounts).reduce((sum, count) => sum + count, 0);
    console.log(
      `Migration rehearsal passed: ${basename(options.source)} v${beforeVersion} → v${DB_SCHEMA_VERSION}; ` +
        `${Object.keys(beforeCounts).length} tables / ${totalRows} rows; value-preserving happy path, verified rollback snapshot, ` +
        `simulated ENOSPC rollback, forced-termination recovery, and idempotent reopen all passed.`,
    );
    if (options.keep) console.log(`Anonymised rehearsal artifacts retained at ${directory}`);
  } finally {
    if (!options.keep) rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--worker-kill") {
    const sourcePath = process.argv[3];
    const targetVersion = Number(process.argv[4]);
    if (!sourcePath || !Number.isSafeInteger(targetVersion) || targetVersion <= 0) {
      throw new Error("--worker-kill requires a positive target migration version");
    }
    await runKilledMigrationWorker(resolve(sourcePath), targetVersion);
  } else {
    await main();
  }
}
