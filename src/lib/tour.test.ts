import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config, Driver } from "driver.js";
import { m } from "@/i18n";
import { TOUR_ANCHORS } from "./tourAnchors";

// driver.js itself is loaded lazily inside startTour (see the file header comment in tour.ts), so
// the mock only needs to cover the dynamic `import("driver.js")`, not a static import binding.
const driverMock = vi.hoisted(() => vi.fn<(options?: Config) => Driver>());
vi.mock("driver.js", () => ({ driver: driverMock }));

import { startTour } from "./tour";

const expectedSteps: NonNullable<Config["steps"]> = [
  { element: TOUR_ANCHORS[0], popover: { title: m.tour_grid_title(), description: m.tour_grid_desc() } },
  { element: TOUR_ANCHORS[1], popover: { title: m.tour_toolbar_title(), description: m.tour_toolbar_desc() } },
  {
    element: TOUR_ANCHORS[2],
    popover: { title: m.tour_people_title(), description: m.tour_people_desc(), side: "right" },
  },
  {
    element: TOUR_ANCHORS[3],
    popover: { title: m.tour_clients_title(), description: m.tour_clients_desc(), side: "right" },
  },
  {
    element: TOUR_ANCHORS[4],
    popover: { title: m.tour_settings_title(), description: m.tour_settings_desc(), side: "right" },
  },
];
const firstExpectedStep = expectedSteps[0];
if (!firstExpectedStep) throw new Error("tour test steps are unexpectedly empty");

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

describe("startTour", () => {
  let driveSpy: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    document.body.className = "";
    driveSpy = vi.fn<() => void>();
    driverMock.mockReset().mockReturnValue(createDriverStub(driveSpy, vi.fn()));
  });

  afterEach(() => {
    document.body.className = "";
    vi.restoreAllMocks();
  });

  it("builds the five spotlight steps from the shared anchors and translated copy, in order", async () => {
    await startTour();

    expect(driverMock).toHaveBeenCalledOnce();
    const config = getDriverConfig();
    expect(config.steps).toEqual(expectedSteps);
  });

  it("configures progress display and nav copy through the Paraglide messages", async () => {
    await startTour();

    const config = getDriverConfig();
    expect(config.showProgress).toBe(true);
    expect(config.progressText).toBe(m.tour_progress({ step: "{{current}}", total: "{{total}}" }));
    expect(config.nextBtnText).toBe(m.tour_next());
    expect(config.prevBtnText).toBe(m.tour_prev());
    expect(config.doneBtnText).toBe(m.tour_done());
  });

  it("keeps spotlighted elements inert so a stray click can't navigate away mid-tour", async () => {
    await startTour();

    const config = getDriverConfig();
    expect(config.disableActiveInteraction).toBe(true);
  });

  it("hands teardown ownership to driver.js's own destroy through onDestroyStarted", async () => {
    const promise = startTour();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const config = getDriverConfig();
    const destroySpy = vi.fn();
    const activeTour = createDriverStub(vi.fn(), destroySpy);
    config.onDestroyStarted?.(undefined, firstExpectedStep, {
      config,
      state: {},
      driver: activeTour,
      index: undefined,
    });

    expect(destroySpy).toHaveBeenCalledOnce();
    await promise;
  });

  it("drives the tour after building it", async () => {
    await startTour();

    expect(driveSpy).toHaveBeenCalledOnce();
  });

  it("resolves once driven, when the body never carried the driver-active class", async () => {
    const disconnectSpy = vi.spyOn(MutationObserver.prototype, "disconnect");

    await expect(startTour()).resolves.toBeUndefined();

    expect(disconnectSpy).toHaveBeenCalledOnce();
  });

  it("watches only class changes on document.body", async () => {
    const observeSpy = vi.spyOn(MutationObserver.prototype, "observe");

    await startTour();

    expect(observeSpy).toHaveBeenCalledOnce();
    expect(observeSpy).toHaveBeenCalledWith(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
  });

  it("stays pending while driver-active is set, and resolves only once it's removed", async () => {
    document.body.classList.add("driver-active");

    let resolved = false;
    const promise = startTour().then(() => {
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

    await expect(startTour()).rejects.toBe(failure);
  });
});
