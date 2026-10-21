import type { Db } from "../db";

/**
 * Describes the synchronous SQLite statement operations used by control-table helpers.
 */
export type PreparedStatement = ReturnType<Db["prepare"]>;

/** Caches each prepared statement per database handle without preventing unreachable handles from being collected.
 * Failed preparation propagates and is never cached.
 */
export function cachedStatement(sql: string): (db: Db) => PreparedStatement {
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
