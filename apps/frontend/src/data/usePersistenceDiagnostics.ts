import { useMemo } from "react";
import { useStore } from "@/store/useStore";
import { isDemoMode } from "./apiConfig";
import { readPlanningDiagnostics } from "./persistenceDiagnostics";

/** Observes the same planning metadata that gates the scheduler's writes and history. */
export function usePersistenceDiagnostics() {
  const planning = useStore((state) => state.planning);
  const past = useStore((state) => state.past.length);
  const future = useStore((state) => state.future.length);
  const demo = isDemoMode();
  return useMemo(() => readPlanningDiagnostics(planning, demo, { past, future }), [planning, demo, past, future]);
}
