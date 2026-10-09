import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config, Driver } from "driver.js";
import { buildRoleTour } from "./tourSteps";

// driver.js itself is loaded lazily inside startTour (see the file header comment in tour.ts), so
// the mock only needs to cover the dynamic `import("driver.js")`, not a static import binding.
const driverMock = vi.hoisted(() => vi.fn<(options?: Config) => Driver>());
vi.mock("driver.js", () => ({ driver: driverMock }));

import { startTour } from "./tour";

const expectedAnchors = [
  '[data-nav="/settings"]',
  '[data-nav="/team"]',
  '[data-nav="/settings"]',
  '[data-nav="/resources"]',
  '[data-nav="/clients"]',
  '[data-testid="scheduler-grid"]',
  '[data-testid="scheduler-grid"]',
  '[data-testid="scheduler-toolbar"]',
];
const navigate = vi.fn();
const launchTour = () => startTour({ role: "owner", navigate, serverMode: true });
function getDriverConfig(): Config {
  const config = driverMock.mock.calls[0]?.[0];
  if (!config) throw new Error("driver mock was not called with a config");
  return config;
}

function unexpectedDriverCall(): never {
  throw new Error("unexpected driver call");
}

function createDriverStub(drive: () => void, destroy: () => void): Driver {
  return {
    isActive: unexpectedDriverCall,
    refresh: unexpectedDriverCall,
    drive,
    setConfig: unexpectedDriverCall,
    setSteps: unexpectedDriverCall,
    getConfig: unexpectedDriverCall,
    getState: unexpectedDriverCall,
    getActiveIndex: unexpectedDriverCall,
    isFirstStep: unexpectedDriverCall,
    isLastStep: unexpectedDriverCall,
    getActiveStep: unexpectedDriverCall,
    getActiveElement: unexpectedDriverCall,
    getPreviousElement: unexpectedDriverCall,
    getPreviousStep: unexpectedDriverCall,
    getNextStep: unexpectedDriverCall,
    moveNext: unexpectedDriverCall,
    movePrevious: unexpectedDriverCall,
    moveTo: unexpectedDriverCall,
    hasNextStep: unexpectedDriverCall,
    hasPreviousStep: unexpectedDriverCall,
    highlight: unexpectedDriverCall,
    destroy,
  };
}

let driveSpy: ReturnType<typeof vi.fn<() => void>>;

function registerConfigurationTests() {
  it("builds the eight role stops in order with locale-resolved copy", async () => {
    await launchTour();

    expect(driverMock).toHaveBeenCalledOnce();
    const config = getDriverConfig();
    const steps = config.steps;
    if (!steps) throw new Error("tour config did not include steps");
    expect(steps.map((step) => step.element)).toEqual(expectedAnchors);
    expect(steps.every((step) => Boolean(step.popover?.title && step.popover.description))).toBe(true);
    expect(steps.map((step) => step.waitForElement ?? 0)).toEqual([0, 0, 0, 0, 0, 1000, 1000, 1000]);
    expect(steps.filter((_step, index) => [0, 1, 3, 6].includes(index)).map((step) => step.popover?.title)).toEqual([
      expect.stringMatching(/^Owner:/),
      expect.stringMatching(/^Admin:/),
      expect.stringMatching(/^Editor:/),
      expect.stringMatching(/^Viewer:/),
    ]);
    expect(steps.every((step) => (step.popover?.description ?? "").trim().split(/\s+/).length <= 25)).toBe(true);
  });

  it("configures progress display and nav copy through the Paraglide messages", async () => {
    await launchTour();

    const config = getDriverConfig();
    expect(config.showProgress).toBe(true);
    expect(config.progressText).toContain("{{current}}");
    expect(config.progressText).toContain("{{total}}");
    expect(config.nextBtnText).toBe("Next");
    expect(config.prevBtnText).toBe("Back");
    expect(config.doneBtnText).toBe("Done");
  });

  it("keeps spotlighted elements inert so a stray click can't navigate away mid-tour", async () => {
    await launchTour();

    const config = getDriverConfig();
    expect(config.disableActiveInteraction).toBe(true);
  });
}

function registerNavigationTests() {
  it("hands teardown ownership to driver.js's own destroy through onDestroyStarted", async () => {
    const promise = launchTour();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const config = getDriverConfig();
    const firstStep = config.steps?.[0];
    if (!firstStep) throw new Error("tour config did not include its first step");
    const destroySpy = vi.fn();
    const activeTour = createDriverStub(vi.fn(), destroySpy);
    config.onDestroyStarted?.(undefined, firstStep, {
      config,
      state: {},
      driver: activeTour,
      index: undefined,
    });

    expect(destroySpy).toHaveBeenCalledOnce();
    await promise;
  });

  it("drives the tour after building it", async () => {
    await launchTour();

    expect(driveSpy).toHaveBeenCalledOnce();
  });
}

function registerLifecycleTests() {
  it("resolves once driven, when the body never carried the driver-active class", async () => {
    const disconnectSpy = vi.spyOn(MutationObserver.prototype, "disconnect");

    await expect(launchTour()).resolves.toBeUndefined();

    expect(disconnectSpy).toHaveBeenCalledOnce();
  });

  it("watches only class changes on document.body", async () => {
    const observeSpy = vi.spyOn(MutationObserver.prototype, "observe");

    await launchTour();

    expect(observeSpy).toHaveBeenCalledOnce();
    expect(observeSpy).toHaveBeenCalledWith(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
  });

  it("stays pending while driver-active is set, and resolves only once it's removed", async () => {
    document.body.classList.add("driver-active");

    let resolved = false;
    const promise = launchTour().then(() => {
      resolved = true;
    });

    // Let the MutationObserver's microtask queue (and the explicit finishIfDestroyed() call right
    // after drive()) settle before asserting nothing has resolved yet.
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolved).toBe(false);

    document.body.classList.remove("driver-active");
    await promise;

    expect(resolved).toBe(true);
  });

  it("rejects with the original error and never hangs when building the tour throws", async () => {
    const failure = new Error("driver.js explosion");
    driverMock.mockImplementation(() => {
      throw failure;
    });

    await expect(launchTour()).rejects.toBe(failure);
  });

  it("navigates to the schedule before starting when launched off-page", async () => {
    window.history.replaceState({}, "", "/settings");
    await startTour({ role: "editor", navigate, serverMode: true });
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("builds the selected role's own segment and lower stops", () => {
    expect(buildRoleTour({ role: "viewer", serverMode: true }).map((step) => step.id)).toEqual([
      "viewer-grid",
      "viewer-toolbar",
    ]);
  });
}

describe("startTour", () => {
  beforeEach(() => {
    document.body.className = "";
    window.history.replaceState({}, "", "/");
    navigate.mockReset();
    driveSpy = vi.fn<() => void>();
    driverMock.mockReset().mockReturnValue(createDriverStub(driveSpy, vi.fn()));
  });

  afterEach(() => {
    document.body.className = "";
    vi.restoreAllMocks();
  });

  registerConfigurationTests();
  registerNavigationTests();
  registerLifecycleTests();
});
