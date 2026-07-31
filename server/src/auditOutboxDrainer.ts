import type { AuditSink } from "./audit";
import { drainAuditOutbox, pendingAuditCount } from "./auditOutbox";
import type { Db } from "./db";

export interface AuditOutboxDrainer {
  /** Deliver at most one bounded page and schedule later pages between event-loop turns. */
  drainOnce(): boolean;
  pendingCount(): number;
  stop(): void;
}

/** Own progressive audit recovery without keeping the process alive or outliving Fastify. */
export function createAuditOutboxDrainer(
  db: Db,
  sink: AuditSink,
  reportBackgroundFailure: (error: unknown) => void,
): AuditOutboxDrainer {
  let scheduled: NodeJS.Immediate | null = null;
  let stopped = false;

  const scheduleNext = (): void => {
    if (stopped || scheduled !== null || !db.isOpen) return;
    scheduled = setImmediate(() => {
      scheduled = null;
      try {
        drainOnce();
      } catch (error) {
        reportBackgroundFailure(error);
      }
    });
    scheduled.unref();
  };

  const drainOnce = (): boolean => {
    if (stopped || !db.isOpen) return true;
    const delivered = drainAuditOutbox(db, sink);
    if (delivered && pendingAuditCount(db) > 0) scheduleNext();
    return delivered;
  };

  return {
    drainOnce,
    pendingCount: () => (db.isOpen ? pendingAuditCount(db) : 0),
    stop() {
      stopped = true;
      if (scheduled !== null) clearImmediate(scheduled);
      scheduled = null;
    },
  };
}
