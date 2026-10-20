import { isPlanningHistoryReady } from "./planning/planningCacheController";
import type { PlanningControllerMetadata, PlanningStatus } from "./planning/planningCacheController";

/** Privacy-safe facts about the current planning cache, without rows or execution identifiers. */
export interface PersistenceDiagnostics {
  status: PlanningStatus | "demo";
  revision: number | null;
  commitment: "none" | "unknown" | "confirmed";
  canUndo: boolean;
  canRedo: boolean;
}

/** Projects controller metadata into the support report's fixed public fields. */
export function readPlanningDiagnostics(
  planning: PlanningControllerMetadata,
  demo: boolean,
  localHistory: { past: number; future: number },
): PersistenceDiagnostics {
  return {
    status: demo ? "demo" : planning.status,
    revision: demo ? null : planning.revision,
    commitment: planning.pending ? (planning.pending.commitment ? "confirmed" : "unknown") : "none",
    canUndo: demo ? localHistory.past > 0 : planning.history.past.length > 0 && isPlanningHistoryReady(planning),
    canRedo: demo ? localHistory.future > 0 : planning.history.future.length > 0 && isPlanningHistoryReady(planning),
  };
}
