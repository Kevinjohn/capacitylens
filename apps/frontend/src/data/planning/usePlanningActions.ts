import { useMemo, useState } from "react";
import type { PlanningDraft } from "./planningCacheController";
import { capturePlanningDraft, planningActions } from "./planningActions";
import type { PlanningActions } from "./planningActions";

/** Retains the form's opening revision and writable values across background refreshes. */
export function usePlanningDraft(originalWritable: unknown): PlanningDraft | null {
  const [draft] = useState(() => capturePlanningDraft(originalWritable));
  return draft;
}

/** Binds one captured form draft to the asynchronous mutation surface. */
export function usePlanningActions(draft?: PlanningDraft | null): PlanningActions {
  return useMemo(() => {
    const bound = Object.fromEntries(
      Object.entries(planningActions).map(([name, action]) => [
        name,
        (...parameters: unknown[]) => Reflect.apply(action, planningActions, [...parameters, draft]),
      ]),
    );
    // Each public action has one optional trailing draft; binding preserves its other arguments.
    return bound as PlanningActions;
  }, [draft]);
}
