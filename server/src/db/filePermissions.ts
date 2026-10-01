import type { Db } from "../db";
import { chmodSync } from "node:fs";
// DatabaseSync does not expose its filename. Retain it only for handles opened through this module
// so mutating initialization/recovery can harden an identified file; read-only planning never does.
export const databasePaths = new WeakMap<Db, string>();

export function restrictIdentifiedDatabasePermissions(db: Db): void {
  const path = databasePaths.get(db);
  if (!path || path === ":memory:") return;
  try {
    chmodSync(path, 0o600);
    // WAL/SHM may not exist until the first write; the process umask protects later files.
  } catch (cause) {
    throw new Error(`Could not restrict database permissions at "${path}".`, {
      cause,
    });
  }
}
