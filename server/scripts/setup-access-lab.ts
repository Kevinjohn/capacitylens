import { authFromEnv, runAuthMigrations } from "../src/auth";
import { existsSync } from "node:fs";
import { upsertMember } from "../src/controlTables";
import { insertAll, openDb } from "../src/db";
import {
  ACCESS_LAB_ACCOUNT_ID,
  ACCESS_LAB_PASSWORD,
  ACCESS_LAB_PERSONAS,
  buildAccessLabData,
  resolveAccessLabDbPath,
} from "../src/accessLab";
import { buildAccessLabEnv } from "../../scripts/access-lab-env.mjs";

process.umask(0o077);

// Pin the destructive fixture builder itself, not only its convenience launcher. This keeps a
// direct invocation from inheriting production identity secrets, providers, MFA or breach checks.
const labEnv = buildAccessLabEnv(process.env, { apiPort: 8897, webPort: 5473 });

const dbPath = resolveAccessLabDbPath(labEnv.CAPACITYLENS_DB);
if ([dbPath, `${dbPath}-wal`, `${dbPath}-shm`].some((path) => existsSync(path))) {
  throw new Error("Access-lab setup requires the launcher to remove the fixed fixture first.");
}

const db = openDb(dbPath);
try {
  const existingAccounts = (
    db.prepare("SELECT COUNT(*) AS count FROM accounts").get() as {
      count: number;
    }
  ).count;
  if (existingAccounts !== 0) throw new Error("Access-lab database is not empty; the launcher must reset it first.");

  const { mode, auth } = authFromEnv(db, labEnv, {
    trustedOrigins: ["http://localhost:5473", "http://127.0.0.1:5473"],
  });
  if (mode !== "password" || !auth) throw new Error("Access lab requires password authentication.");
  await runAuthMigrations(auth);
  insertAll(db, buildAccessLabData());

  const createdAt = new Date().toISOString();
  for (const persona of ACCESS_LAB_PERSONAS) {
    const user = await auth.createCredentialUser(persona.email, persona.name, ACCESS_LAB_PASSWORD, true);
    upsertMember(db, {
      accountId: ACCESS_LAB_ACCOUNT_ID,
      userId: user.id,
      role: persona.role,
      status: "active",
      createdAt,
    });
  }
} finally {
  db.close();
}

console.log("Access lab ready: Studio North with Owner, Admin, Editor, and Viewer personas.");
