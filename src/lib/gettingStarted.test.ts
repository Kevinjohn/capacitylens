import { describe, it, expect } from "vitest";
import { buildGettingStartedSteps, hasCompletedAllSteps, isGettingStartedComplete } from "./gettingStarted";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { buildInternalClient } from "@capacitylens/shared/data/internalClient";
import {
  FIXTURE_ALLOCATION,
  FIXTURE_ACTIVITY,
  FIXTURE_CLIENT,
  FIXTURE_PROJECT,
  FIXTURE_RESOURCE as FIXTURE_PLACEHOLDER,
  FIXTURE_RESOURCE_EXTERNAL,
} from "@capacitylens/shared/data/fixtures";
import type { AppData } from "@capacitylens/shared/types/entities";

// Pure derivation tests only — the card's render/visibility rules (dismissed flag, all-done,
// viewer role) ride on the store and are exercised end-to-end in e2e/getting-started.spec.ts.

const NOW = "2026-06-03T12:00:00.000Z";

/** A fresh AppData with the given slices. Production passes the active-only projection from
 *  useActiveScopedData; these pure tests make any lifecycle state they exercise explicit. */
function dataWith(slices: Partial<AppData>): AppData {
  return { ...emptyAppData(), ...slices };
}

describe("deriveGettingStartedSteps", () => {
  it("reports nothing done on an empty account", () => {
    expect(buildGettingStartedSteps(emptyAppData())).toEqual({
      client: false,
      project: false,
      activity: false,
      person: false,
      assign: false,
    });
  });

  it('does NOT count the built-in Internal client as "your first client"', () => {
    const data = dataWith({ clients: [buildInternalClient("a1", NOW)] });
    expect(buildGettingStartedSteps(data).client).toBe(false);
  });

  it("counts a real (non-builtin) client", () => {
    const activeClient = { ...FIXTURE_CLIENT };
    delete activeClient.archivedAt;
    delete activeClient.deletedAt;
    const data = dataWith({
      clients: [buildInternalClient("a1", NOW), activeClient],
    });
    expect(buildGettingStartedSteps(data).client).toBe(true);
  });

  it("counts an imported activity without requiring a disposable replacement", () => {
    expect(buildGettingStartedSteps(dataWith({ activities: [FIXTURE_ACTIVITY] })).activity).toBe(true);
  });

  it("relies on the caller to remove deleted clients from its active projection", () => {
    // deriveGettingStartedSteps deliberately classifies only row kind/presence. Its production
    // caller passes useActiveScopedData(), so a tombstone never reaches this function there.
    expect(buildGettingStartedSteps(dataWith({ clients: [FIXTURE_CLIENT] })).client).toBe(true);
  });

  it.each([
    ["placeholder", FIXTURE_PLACEHOLDER],
    ["external", FIXTURE_RESOURCE_EXTERNAL],
  ] as const)("does not count %s resources as the first person", (_label, resource) => {
    expect(buildGettingStartedSteps(dataWith({ resources: [resource] })).person).toBe(false);
  });

  it("ticks each remaining step off its own slice", () => {
    const person = {
      ...FIXTURE_PLACEHOLDER,
      kind: "person" as const,
      name: "Fixture Person",
    };
    delete person.projectId;
    const data = dataWith({
      projects: [FIXTURE_PROJECT],
      activities: [FIXTURE_ACTIVITY],
      resources: [person],
      allocations: [FIXTURE_ALLOCATION],
    });
    expect(buildGettingStartedSteps(data)).toEqual({
      client: false,
      project: true,
      activity: true,
      person: true,
      assign: true,
    });
  });
});

describe("allStepsDone", () => {
  it("is true only when every step is complete", () => {
    expect(hasCompletedAllSteps({ client: true, project: true, activity: true, person: true, assign: true })).toBe(
      true,
    );
  });

  it.each([
    ["client", { client: false, project: true, activity: true, person: true, assign: true }],
    ["project", { client: true, project: false, activity: true, person: true, assign: true }],
    ["activity", { client: true, project: true, activity: false, person: true, assign: true }],
    ["person", { client: true, project: true, activity: true, person: false, assign: true }],
    ["assign", { client: true, project: true, activity: true, person: true, assign: false }],
  ] as const)("is false when %s is incomplete", (_label, steps) => {
    expect(hasCompletedAllSteps(steps)).toBe(false);
  });
});

describe("onboarding completion", () => {
  const steps = { client: true, project: true, activity: true, person: true, assign: true };
  it("keeps Settings review pending for someone who started setup without choosing a path", () => {
    expect(
      isGettingStartedComplete(steps, {
        started: true,
        importChosen: false,
        scratchChosen: false,
        settingsReviewed: false,
      }),
    ).toBe(false);
  });
  it("does not reopen onboarding for an established company", () => {
    expect(
      isGettingStartedComplete(steps, {
        started: false,
        importChosen: false,
        scratchChosen: false,
        settingsReviewed: false,
      }),
    ).toBe(true);
  });
});
