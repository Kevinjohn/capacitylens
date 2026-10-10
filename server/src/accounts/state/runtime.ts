import type { Db } from "../../db";

export type PreparedStatement = ReturnType<Db["prepare"]>;

/** Create an accessor that reuses one prepared statement per database handle.
 * Each factory call owns a WeakMap cache; failed `db.prepare` calls propagate and are not cached.
 * This module-local copy of the `auditOutbox.ts`/`controlTables.ts` idiom is deliberately not
 * imported from controlTables: coordinator state stays free of control-table dependency edges,
 * as enforced by `conformance/architecture.test.ts`'s deny-by-default importer allow-list and the
 * coordinator-persistence transitive scan. WeakMap keys let short-lived test handles be collected. */
export function createCachedStatement(sql: string): (db: Db) => PreparedStatement {
  const cache = new WeakMap<Db, PreparedStatement>();
  return (db: Db): PreparedStatement => {
    let statement = cache.get(db);
    if (!statement) {
      statement = db.prepare(sql);
      cache.set(db, statement);
    }
    return statement;
  };
}

/** Minimum interval between durable command and assurance housekeeping sweeps per database handle. */
export const HOUSEKEEPING_INTERVAL_MS = 5 * 60 * 1000;
/** Last command sweep time, scoped to each database handle so closed handles can be collected. */
export const lastCommandSweep = new WeakMap<Db, number>();
/** Last assurance sweep time, scoped to each database handle so closed handles can be collected. */
export const lastAssuranceSweep = new WeakMap<Db, number>();

// Durable rows need wall-shaped ISO timestamps, but lifetime decisions must not follow a host clock
// step while this process is alive. Anchor wall time once and advance it with the monotonic process
// clock: NTP/VM corrections after startup can neither terminalize every pending command nor prune a
// month of replay history instantly. A restart deliberately adopts the then-current host clock so
// durable retention can advance across downtime; operators must still keep startup time sane.
const PROCESS_WALL_ORIGIN_MS = Date.now();
const PROCESS_MONOTONIC_ORIGIN_MS = performance.now();
/** Read wall-clock-shaped milliseconds advanced by the monotonic clock since process startup; a restart reanchors it. */
export const readStableNowMilliseconds = (): number =>
  PROCESS_WALL_ORIGIN_MS + (performance.now() - PROCESS_MONOTONIC_ORIGIN_MS);
/** Read the stable process clock as an ISO timestamp. */
export const readStableNowIso = (): string => new Date(readStableNowMilliseconds()).toISOString();
