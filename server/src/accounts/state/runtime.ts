import type { Db } from "../../db";

export type PreparedStatement = ReturnType<Db["prepare"]>;

/**
 * Per-handle prepared-statement cache, module-local copy of the auditOutbox.ts/controlTables.ts
 * idiom. Deliberately NOT imported from controlTables: coordinator state must stay free of
 * control-table dependency edges (enforced by conformance/architecture.test.ts's deny-by-default
 * importer allow-list and the coordinator-persistence transitive scan). WeakMap keyed by the Db
 * handle so test `:memory:` handles never leak.
 */
export function cachedStatement(sql: string): (db: Db) => PreparedStatement {
  const cache = new WeakMap<Db, PreparedStatement>();
  return (db: Db): PreparedStatement => {
    let stmt = cache.get(db);
    if (!stmt) {
      stmt = db.prepare(sql);
      cache.set(db, stmt);
    }
    return stmt;
  };
}

export const HOUSEKEEPING_INTERVAL_MS = 5 * 60 * 1000;
export const lastCommandSweep = new WeakMap<Db, number>();
export const lastAssuranceSweep = new WeakMap<Db, number>();

// Durable rows need wall-shaped ISO timestamps, but lifetime decisions must not follow a host clock
// step while this process is alive. Anchor wall time once and advance it with the monotonic process
// clock: NTP/VM corrections after startup can neither terminalize every pending command nor prune a
// month of replay history instantly. A restart deliberately adopts the then-current host clock so
// durable retention can advance across downtime; operators must still keep startup time sane.
const PROCESS_WALL_ORIGIN_MS = Date.now();
const PROCESS_MONOTONIC_ORIGIN_MS = performance.now();
export const stableNowMs = (): number => PROCESS_WALL_ORIGIN_MS + (performance.now() - PROCESS_MONOTONIC_ORIGIN_MS);
export const stableNowIso = (): string => new Date(stableNowMs()).toISOString();
