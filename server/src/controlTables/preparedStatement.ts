import type { Db } from "../db";

export type PreparedStatement = ReturnType<Db["prepare"]>;

/**
 * Factory for a per-handle prepared-statement cache, so a hot control-table read is prepared at
 * most once per Db handle rather than on every call. Each factory call owns its cache; failed
 * `db.prepare` calls propagate and are not cached. WeakMap keyed by the Db handle, mirroring
 * `auth.ts`'s table-existence probe, so an entry is collected with its handle and the many
 * short-lived `:memory:` handles tests open never leak. SQL text is unchanged; only the repeated
 * `prepare()` call is elided.
 *
 * Shared by every control table rather than repeated per module: the membership reads reached via
 * `authorize` and the ownership-transfer invalidation reached from the membership write choke point
 * are on the same request path, and a second private copy of this cache would be one more place for
 * a hot statement to quietly go back to compiling per call.
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
