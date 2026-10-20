import { describe, expect, it } from "vitest";
import { createPlanningCacheState } from "@/data/planning/planningCacheController";
import type { PlanningControllerMetadata, PlanningDraft } from "@/data/planning/planningCacheController";
import { isInlineActivityAcknowledgement } from "./useAllocationModalState";

const context = { identity: "editor-session", companyId: "wayne" };
const draft: PlanningDraft = {
  baseRevision: 7,
  originalWritable: { id: "allocation-1" },
  context,
  generation: 3,
};

function acknowledgedPlanning(revision: number) {
  const initial = createPlanningCacheState().planning;
  return {
    ...initial,
    context,
    canWrite: true,
    revision,
    status: "ready" as const,
    history: { past: [], future: [], tipRevision: revision },
    outcome: { kind: "acknowledged" as const, mutationId: "activity-write", revision },
  };
}

describe("inline activity form revision", () => {
  it("advances only for one acknowledged revision in the captured access context", () => {
    expect(isInlineActivityAcknowledgement(draft, acknowledgedPlanning(8))).toBe(true);
    expect(isInlineActivityAcknowledgement(draft, acknowledgedPlanning(9))).toBe(false);
    expect(
      isInlineActivityAcknowledgement(draft, {
        ...acknowledgedPlanning(8),
        context: { identity: "different-session", companyId: "wayne" },
      }),
    ).toBe(false);
    expect(
      isInlineActivityAcknowledgement(draft, {
        ...acknowledgedPlanning(8),
        pending: {} as NonNullable<PlanningControllerMetadata["pending"]>,
      }),
    ).toBe(false);
  });
});
