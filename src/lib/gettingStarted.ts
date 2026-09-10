import { isBuiltinClient } from "@capacitylens/shared/data/internalClient";
import type { AppData } from "@capacitylens/shared/types/entities";
import { STORAGE_KEY_PREFIX } from "@capacitylens/shared/brand";

// Pure derivation for the first-run "Getting started" checklist (components/GettingStarted.tsx):
// which onboarding steps the active account has completed, read straight off its scoped data.
// Kept out of the component file so it's a plain testable function (and mutation-tested with the
// other src/lib helpers).

/** Which onboarding steps the active account has completed. */
export interface GettingStartedSteps {
  client: boolean;
  project: boolean;
  activity: boolean;
  person: boolean;
  assign: boolean;
}

/**
 * Derive checklist completion from an account's active-only scoped {@link AppData}.
 *
 * Callers must pass the projection returned by `useActiveScopedData`; this deliberately simple
 * presence classifier does not repeat lifecycle filtering, so raw archived or soft-deleted rows
 * would otherwise tick a step. The built-in Internal client does not count because every account
 * has it and it is not “your first client”.
 */
export function buildGettingStartedSteps(data: AppData): GettingStartedSteps {
  return {
    client: data.clients.some((client) => !isBuiltinClient(client)),
    project: data.projects.length > 0,
    activity: data.activities.length > 0,
    person: data.resources.some((resource) => resource.kind === "person"),
    assign: data.allocations.length > 0,
  };
}

export function hasExistingSetupData(steps: GettingStartedSteps): boolean {
  return Object.values(steps).some(Boolean);
}

export interface GettingStartedProgress {
  importChosen: boolean;
  scratchChosen: boolean;
  settingsReviewed: boolean;
}

const emptyProgress: GettingStartedProgress = { importChosen: false, scratchChosen: false, settingsReviewed: false };

function progressKey(accountId: string): string {
  return `${STORAGE_KEY_PREFIX}gettingStartedProgress/${accountId}`;
}

export function readGettingStartedProgress(accountId: string | null): GettingStartedProgress {
  if (!accountId) return { ...emptyProgress };
  try {
    const parsed = JSON.parse(
      localStorage.getItem(progressKey(accountId)) ?? "null",
    ) as Partial<GettingStartedProgress> | null;
    return {
      importChosen: parsed?.importChosen === true,
      scratchChosen: parsed?.scratchChosen === true,
      settingsReviewed: parsed?.settingsReviewed === true,
    };
  } catch {
    return { ...emptyProgress };
  }
}

export function writeGettingStartedProgress(accountId: string, progress: GettingStartedProgress): void {
  try {
    localStorage.setItem(progressKey(accountId), JSON.stringify(progress));
  } catch {
    // Best-effort device guidance only; account data is never written here.
  }
}

export function isGettingStartedComplete(steps: GettingStartedSteps, progress: GettingStartedProgress): boolean {
  if (!hasCompletedAllSteps(steps)) return false;
  return (!progress.importChosen && !progress.scratchChosen) || progress.settingsReviewed;
}

/** Whether every step is complete (the card hides once true). `Object.values(...).every(Boolean)`
 *  is exhaustive BY CONSTRUCTION over {@link GettingStartedSteps}' fields — unlike a hand-enumerated
 *  `steps.a && steps.b && ...`, adding a fifth step here can't silently compile against a stale
 *  list and hide the card too early. */
export function hasCompletedAllSteps(steps: GettingStartedSteps): boolean {
  return Object.values(steps).every(Boolean);
}
