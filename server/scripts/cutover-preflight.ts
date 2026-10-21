import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { inspectSsoCutoverPreflight } from "../src/cutoverPreflight";

async function main(): Promise<void> {
  const databaseArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  const databasePath = resolve(databaseArgument ?? process.env.CAPACITYLENS_DB ?? "capacitylens.db");
  if (!existsSync(databasePath)) {
    throw new Error(`The cutover database does not exist: ${databasePath}`);
  }
  // The preflight is evidence only: opening read-only prevents accidental file creation or any
  // semantic drift while operators are still repairing the mixed-mode installation.
  const db = new DatabaseSync(databasePath, {
    readOnly: true,
    enableForeignKeyConstraints: false,
    timeout: 5000,
  });
  try {
    const readiness = await inspectSsoCutoverPreflight(db, process.env);
    process.stdout.write(`${JSON.stringify(readiness, null, 2)}\n`);
    if (!readiness.ready) process.exitCode = 1;
  } finally {
    db.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
