import { MAX_RECOVERY_DELIVERY_IDS } from "./types";
import type { AuditSink } from "./types";
/** Returns a sink that accepts records without writing them or reporting degradation. */
export function createNoopAuditSink(): AuditSink {
  return {
    append: () => true,
    appendMany: () => true,
    degraded: false,
  };
}

/** Emits JSONL audit records and suppresses repeated delivery IDs within a bounded in-process window.
 * Returns false and latches degraded health on writer failure; the outbox retains the records for retry.
 * IDs outside the retained window may be emitted again.
 */
export function createStreamAuditSink(write: (line: string) => void): AuditSink {
  let degraded = false;
  const recentlyEmitted = new Set<string>();
  const remember = (auditId: string | undefined) => {
    if (auditId === undefined) return;
    if (recentlyEmitted.size >= MAX_RECOVERY_DELIVERY_IDS) {
      const oldest = recentlyEmitted.values().next();
      if (!oldest.done) recentlyEmitted.delete(oldest.value);
    }
    recentlyEmitted.add(auditId);
  };
  const appendMany: NonNullable<AuditSink["appendMany"]> = (records) => {
    try {
      let ok = true;
      for (const record of records) {
        // Recovered records can include an ID already written by this sink.
        if (record.auditId !== undefined && recentlyEmitted.has(record.auditId)) continue;
        try {
          write(JSON.stringify({ type: "capacitylens.audit", ...record }));
          remember(record.auditId);
        } catch {
          // Keep processing records, but report sink degradation so the outbox can retry.
          degraded = true;
          ok = false;
        }
      }
      return ok;
    } catch {
      // The batch could not be delivered, so report degradation and let the outbox retry.
      degraded = true;
      return false;
    }
  };
  return {
    append: (record) => appendMany([record]),
    appendMany,
    get degraded() {
      return degraded;
    },
  };
}

/** Require all configured destinations to accept a record; degradation is the union of sinks. */
export function createCompositeAuditSink(...sinks: AuditSink[]): AuditSink {
  return {
    append(record) {
      return sinks.map((sink) => sink.append(record)).every(Boolean);
    },
    appendMany(records) {
      return sinks
        .map((sink) =>
          sink.appendMany ? sink.appendMany(records) : records.map((record) => sink.append(record)).every(Boolean),
        )
        .every(Boolean);
    },
    get degraded() {
      return sinks.some((sink) => sink.degraded);
    },
  };
}
