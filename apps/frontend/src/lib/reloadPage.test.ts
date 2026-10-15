import { afterEach, describe, expect, it, vi } from "vitest";
import { reloadPage } from "./reloadPage";

const realLocation = window.location;

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: realLocation,
  });
});

describe("reloadPage", () => {
  it("reloads through the browser location boundary", () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, reload },
    });

    reloadPage();

    expect(reload).toHaveBeenCalledOnce();
  });
});
