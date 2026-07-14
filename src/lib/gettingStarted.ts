import { isBuiltinClient } from '@capacitylens/shared/data/internalClient'
import type { AppData } from '@capacitylens/shared/types/entities'

// Pure derivation for the first-run "Getting started" checklist (components/GettingStarted.tsx):
// which onboarding steps the active account has completed, read straight off its scoped data.
// Kept out of the component file so it's a plain testable function (and mutation-tested with the
// other src/lib helpers).

/** Which onboarding steps the active account has completed. */
export interface GettingStartedSteps {
  client: boolean
  project: boolean
  person: boolean
  assign: boolean
}

/** Derive the checklist's per-step completion from an account's scoped {@link AppData}. The
 *  built-in Internal client doesn't count — every account has it, it's not "your first client". */
export function deriveGettingStartedSteps(data: AppData): GettingStartedSteps {
  return {
    client: data.clients.some((c) => !isBuiltinClient(c)),
    project: data.projects.length > 0,
    person: data.resources.length > 0,
    assign: data.allocations.length > 0,
  }
}

/** Whether every step is complete (the card hides once true). `Object.values(...).every(Boolean)`
 *  is exhaustive BY CONSTRUCTION over {@link GettingStartedSteps}' fields — unlike a hand-enumerated
 *  `steps.a && steps.b && ...`, adding a fifth step here can't silently compile against a stale
 *  list and hide the card too early. */
export function allStepsDone(steps: GettingStartedSteps): boolean {
  return Object.values(steps).every(Boolean)
}
