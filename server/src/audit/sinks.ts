import { MAX_RECOVERY_DELIVERY_IDS, type AuditSink } from "./types";
/**
 * The no-op sink: every `append` succeeds (returns true) and `degraded` is always false. This is
 * the factory default (buildApp) so the default local/no-server deploy and the whole test suite are
 * byte-identical unless a real sink is explicitly injected.
 */
export function noopAuditSink(): AuditSink {
  return {
    append: () => true,
    appendMany: () => true,
    degraded: false,
  };
}

/** JSON-line audit stream suitable for container stdout and a separate log collector.
 *
 * Retry-idempotent: when a sibling destination in a composite sink fails, the outbox retains the
 * records and redelivers them later. Without dedup, every retry re-printed records this sink had
 * already emitted, amplifying stdout copies. A bounded set of recently emitted auditIds makes
 * redelivery a no-op; beyond the window, at-worst-duplicate delivery resumes (stdout is the
 * best-effort copy — the durable JSONL file is the evidence of record). */
export function streamAuditSink(write: (line: string) => void): AuditSink {
  let degraded = false;
  const recentlyEmitted = new Set<string>();
  const remember = (auditId: string | undefined) => {
    if (auditId === undefined) return;
    if (recentlyEmitted.size >= MAX_RECOVERY_DELIVERY_IDS) {
      recentlyEmitted.delete(recentlyEmitted.values().next().value!);
    }
    recentlyEmitted.add(auditId);
  };
  return {
    append(record) {
      return this.appendMany!([record]);
    },
    appendMany(records) {
      try {
        let ok = true;
        for (const record of records) {
          if (record.auditId !== undefined && recentlyEmitted.has(record.auditId)) continue; // already delivered
          try {
            write(JSON.stringify({ type: "capacitylens.audit", ...record }));
            remember(record.auditId);
          } catch {
            degraded = true;
            ok = false;
          }
        }
        return ok;
      } catch {
        degraded = true;
        return false;
      }
    },
    get degraded() {
      return degraded;
    },
  };
}

/** Require all configured destinations to accept a record; degradation is the union of sinks. */
export function compositeAuditSink(...sinks: AuditSink[]): AuditSink {
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
