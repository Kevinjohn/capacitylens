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

/** Return whether an account has any completed domain setup step. */
export function hasExistingSetupData(steps: GettingStartedSteps): boolean {
  return Object.values(steps).some(Boolean);
}

/** Device-local markers for the setup path chosen by a new company and its Settings review. */
export interface GettingStartedProgress {
  started: boolean;
  importChosen: boolean;
  scratchChosen: boolean;
  settingsReviewed: boolean;
}

const emptyProgress: GettingStartedProgress = {
  started: false,
  importChosen: false,
  scratchChosen: false,
  settingsReviewed: false,
};

function progressKey(accountId: string): string {
  return `${STORAGE_KEY_PREFIX}gettingStartedProgress/${accountId}`;
}

/**
 * Read best-effort, device-local setup progress for an account.
 *
 * A missing account or unreadable/malformed preference returns empty progress. This preference is
 * guidance only and never changes account data; malformed storage is diagnosed with a static
 * warning so stored JSON and account identifiers cannot reach logs.
 */
export function readGettingStartedProgress(accountId: string | null): GettingStartedProgress {
  if (!accountId) return { ...emptyProgress };
  let stored: string | null;
  try {
    stored = localStorage.getItem(progressKey(accountId));
  } catch {
    console.warn("gettingStarted: progress could not be read; using empty progress");
    return { ...emptyProgress };
  }
  try {
    const parsed = JSON.parse(stored ?? "null") as Partial<GettingStartedProgress> | null;
    return {
      started: parsed?.started === true,
      importChosen: parsed?.importChosen === true,
      scratchChosen: parsed?.scratchChosen === true,
      settingsReviewed: parsed?.settingsReviewed === true,
    };
  } catch {
    console.warn("gettingStarted: saved progress could not be parsed; using empty progress");
    return { ...emptyProgress };
  }
}

/**
 * Persist setup progress as a best-effort device preference.
 *
 * A storage failure leaves the caller's in-memory state usable and emits a static diagnostic; it
 * does not block or mutate the account's durable scheduling data.
 */
export function writeGettingStartedProgress(accountId: string, progress: GettingStartedProgress): void {
  try {
    localStorage.setItem(progressKey(accountId), JSON.stringify(progress));
  } catch {
    // Best-effort device guidance only; account data is never written here.
    console.warn("gettingStarted: progress could not be saved; continuing in memory");
  }
}

/**
 * Decide whether the checklist can hide for the current account.
 *
 * An established company whose domain steps are already complete has no recorded setup path and
 * completes immediately. A new setup, identified by started/import/scratch progress, keeps the
 * checklist until the user reviews Settings. Progress persistence is best effort; callers pass the
 * current in-memory markers explicitly when storage is unavailable.
 */
export function isGettingStartedComplete(steps: GettingStartedSteps, progress: GettingStartedProgress): boolean {
  if (!hasCompletedAllSteps(steps)) return false;
  return (!progress.started && !progress.importChosen && !progress.scratchChosen) || progress.settingsReviewed;
}

/** Whether every step is complete (the card hides once true). `Object.values(...).every(Boolean)`
 *  is exhaustive BY CONSTRUCTION over {@link GettingStartedSteps}' fields — unlike a hand-enumerated
 *  `steps.a && steps.b && ...`, adding a fifth step here can't silently compile against a stale
 *  list and hide the card too early. */
export function hasCompletedAllSteps(steps: GettingStartedSteps): boolean {
  return Object.values(steps).every(Boolean);
}
