import { DatabaseSync } from "node:sqlite";
import { getMigrations } from "better-auth/db/migration";
import type { Auth } from "./authTypes";
import { ensureFederatedIdentitySchema, assertFederatedIdentitySchemaCurrent } from "./federatedIdentitySchema";
import { ensureMicrosoftProofGate } from "./microsoftProofGate";
import { ensureFederatedEmailProofGate } from "./federatedEmailProof";

/** Create/upgrade Better Auth's tables in the shared SQLite file. Called at boot only
 * when mode ≠ off. An off-mode DB never grows auth tables (the off guarantee). */
export async function runAuthMigrations(auth: Auth): Promise<void> {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  // Better Auth owns this schema and currently migrates by introspecting/adding tables and fields.
  // Re-introspect after its sequential DDL: startup must not serve traffic after a partial library
  // migration, even if the first pass returned without surfacing the missing remainder.
  const remaining = await planAuthSchemaMigrations(auth);
  if (remaining.pending) {
    throw new Error(
      `Better Auth schema migration did not converge; pending table change(s): ${remaining.tables.join(", ")}`,
    );
  }
  // The library's own check is disabled (see sessionPolicy); its migrations never repair a required
  // column it does not write, and every insert into that table would fail, so refuse to start.
  if (remaining.problems.length > 0) {
    throw new Error(`Better Auth schema migration did not converge; ${remaining.problems.join(" ")}`);
  }
  // Application migrations run before Better Auth creates account on a fresh database, so install its uniqueness backstop afterwards.
  const database: unknown = auth.options.database;
  if (database instanceof DatabaseSync) {
    ensureFederatedIdentitySchema(database);
    assertFederatedIdentitySchemaCurrent(database);
    if (auth.microsoftProof) ensureMicrosoftProofGate(database, auth.microsoftProof.applicationId);
    if (auth.options.socialProviders?.google || auth.options.socialProviders?.github)
      ensureFederatedEmailProofGate(database);
  }
}

interface AuthSchemaMigrationPlan {
  pending: boolean;
  tables: string[];
  /** Schema faults Better Auth's migrations cannot repair, as the library's own sentences. */
  problems: string[];
}

/** Inspect Better Auth's pinned desired schema without executing its DDL. Production startup folds
 * this into the same pre-migration snapshot decision as app-owned migrations. */
export async function planAuthSchemaMigrations(auth: Auth): Promise<AuthSchemaMigrationPlan> {
  const plan: unknown = await getMigrations(auth.options);
  if (!isAuthSchemaMigrationPlan(plan)) {
    throw new Error("Better Auth returned an invalid schema migration plan");
  }
  const tables = [...plan.toBeCreated.map((entry) => entry.table), ...plan.toBeAdded.map((entry) => entry.table)];
  return { pending: tables.length > 0, tables: [...new Set(tables)], problems: plan.schemaProblems };
}

function isAuthSchemaMigrationPlan(value: unknown): value is {
  toBeCreated: Array<{ table: string }>;
  toBeAdded: Array<{ table: string }>;
  schemaProblems: string[];
} {
  if (!value || typeof value !== "object" || !("toBeCreated" in value) || !("toBeAdded" in value)) return false;
  if (!("schemaProblems" in value) || !Array.isArray(value.schemaProblems)) return false;
  return (
    isMigrationTableList(value.toBeCreated) &&
    isMigrationTableList(value.toBeAdded) &&
    value.schemaProblems.every((problem: unknown) => typeof problem === "string")
  );
}

function isMigrationTableList(value: unknown): value is Array<{ table: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (entry: unknown) => entry && typeof entry === "object" && "table" in entry && typeof entry.table === "string",
    )
  );
}
