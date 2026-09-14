import type { AppData } from "@capacitylens/shared/types/entities";
import { STORAGE_KEY_PREFIX } from "@capacitylens/shared/brand";
import { isBuiltinClient } from "@capacitylens/shared/data/internalClient";
import { lifecycleStatus } from "@capacitylens/shared/domain/lifecycle";

// Pure derivation for the first-run "Getting started" checklist (components/GettingStarted.tsx):
// which useful first-use outcomes the active account has completed, read straight off scoped data.
// Kept out of the component file so it's a plain testable function (and mutation-tested with the
// other src/lib helpers).

/** Which onboarding steps the active account has completed. */
export interface GettingStartedSteps {
  person: boolean;
  work: boolean;
  scheduled: boolean;
}

/**
 * Derive checklist completion from an account's active-only scoped {@link AppData}.
 *
 * Production callers pass the active projection, while lifecycle checks here keep the pure
 * contract safe for imported or independently constructed data. Activity ancestry and every
 * allocation reference are verified rather than inferred from row presence.
 */
export function buildGettingStartedSteps(data: AppData): GettingStartedSteps {
  const people = new Set(
    data.resources
      .filter((resource) => lifecycleStatus(resource) === "active" && resource.kind === "person")
      .map(({ id }) => id),
  );
  const clients = new Set(data.clients.filter((client) => lifecycleStatus(client) === "active").map(({ id }) => id));
  const projects = new Map(
    data.projects.filter((project) => lifecycleStatus(project) === "active").map((project) => [project.id, project]),
  );
  const coherentProject = (projectId: string | undefined): boolean => {
    if (!projectId) return false;
    const project = projects.get(projectId);
    return project !== undefined && clients.has(project.clientId);
  };
  const activities = new Map(
    data.activities
      .filter((activity) => lifecycleStatus(activity) === "active")
      .map((activity) => [activity.id, activity]),
  );
  const coherentActivities = new Map(
    [...activities.values()].map((activity) => [
      activity.id,
      activity.kind !== "project" || coherentProject(activity.projectId),
    ]),
  );
  const scheduled = data.allocations.some((allocation) => {
    if (!people.has(allocation.resourceId) || coherentActivities.get(allocation.activityId) !== true) return false;
    const activity = activities.get(allocation.activityId);
    return (
      activity?.kind !== "repeatable" || allocation.projectId === undefined || coherentProject(allocation.projectId)
    );
  });
  return {
    person: people.size > 0,
    work: [...coherentActivities.values()].some(Boolean),
    scheduled,
  };
}

/** Return whether an account has any meaningful active setup data. Client/project rows reveal the
 * milestones even though they are supporting data rather than completion requirements. */
export function hasExistingSetupData(data: AppData, steps: GettingStartedSteps): boolean {
  return (
    Object.values(steps).some(Boolean) ||
    data.clients.some((client) => lifecycleStatus(client) === "active" && !isBuiltinClient(client)) ||
    data.projects.some((project) => lifecycleStatus(project) === "active")
  );
}

/** Legacy-compatible device-local markers that reveal the first-use milestones. */
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
 * Decide whether the first-use guidance can hide for the current account. Only the three durable
 * domain outcomes count; legacy device markers are accepted for API compatibility but never count.
 */
export function isGettingStartedComplete(steps: GettingStartedSteps, progress: GettingStartedProgress): boolean {
  void progress;
  return hasCompletedAllSteps(steps);
}

/** Whether every step is complete (the card hides once true). `Object.values(...).every(Boolean)`
 *  is exhaustive BY CONSTRUCTION over {@link GettingStartedSteps}' fields — unlike a hand-enumerated
 *  `steps.a && steps.b && ...`, adding a fifth step here can't silently compile against a stale
 *  list and hide the card too early. */
export function hasCompletedAllSteps(steps: GettingStartedSteps): boolean {
  return Object.values(steps).every(Boolean);
}
