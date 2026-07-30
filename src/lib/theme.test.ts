import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readStoredTheme, writeStoredTheme, resolveTheme, applyThemeToDom, watchSystemTheme } from "./theme";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.theme;
});

describe("readStoredTheme", () => {
  it("defaults to light when nothing is stored", () => {
    expect(readStoredTheme()).toBe("light");
  });

  it("round-trips a written preference", () => {
    writeStoredTheme("dark");
    expect(readStoredTheme()).toBe("dark");
    writeStoredTheme("system");
    expect(readStoredTheme()).toBe("system");
  });

  it.each(["light", "dark", "system"] as const)("migrates a legacy %s preference once", (preference) => {
    localStorage.setItem("floaty/theme", preference);

    expect(readStoredTheme()).toBe(preference);
    expect(localStorage.getItem("capacitylens/theme")).toBe(preference);
    expect(localStorage.getItem("floaty/theme")).toBeNull();
  });

  it("returns the migrated value when stale-key cleanup fails after the current key is written", () => {
    localStorage.setItem("floaty/theme", "dark");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation((key) => {
      if (key === "floaty/theme") throw new Error("storage cleanup blocked");
    });

    expect(readStoredTheme()).toBe("dark");
    expect(localStorage.getItem("capacitylens/theme")).toBe("dark");
  });

  it.each(["dark", "system"] as const)("uses legacy %s for this session when migration writing fails", (preference) => {
    localStorage.setItem("floaty/theme", preference);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key) => {
      if (key === "capacitylens/theme") throw new Error("storage write blocked");
    });

    expect(readStoredTheme()).toBe(preference);
  });

  it("does not let a legacy preference override an explicit current value", () => {
    localStorage.setItem("capacitylens/theme", "neon");
    localStorage.setItem("floaty/theme", "dark");

    expect(readStoredTheme()).toBe("light");
    expect(localStorage.getItem("floaty/theme")).toBe("dark");
  });

  it("falls back to light for an unrecognised stored value", () => {
    localStorage.setItem("capacitylens/theme", "neon");
    expect(readStoredTheme()).toBe("light");
  });

  it("falls back to light when an empty string is stored", () => {
    // Distinguishes the real 'light'/'dark'/'system' equality checks from a mutant that
    // compares against "" instead — an empty string is neither a valid pref nor 'light'.
    localStorage.setItem("capacitylens/theme", "");
    expect(readStoredTheme()).toBe("light");
  });

  it("persists under the documented storage key", () => {
    writeStoredTheme("dark");
    expect(localStorage.getItem("capacitylens/theme")).toBe("dark");
  });
});

describe("resolveTheme", () => {
  it("returns explicit choices unchanged", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("resolves system to light when matchMedia is unavailable (jsdom)", () => {
    expect(resolveTheme("system")).toBe("light");
  });

  it("resolves system against prefers-color-scheme when matchMedia exists", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("dark"),
      addEventListener() {},
      removeEventListener() {},
    }));
    expect(resolveTheme("system")).toBe("dark");
  });
});

describe("applyThemeToDom", () => {
  it("writes the resolved scheme to <html data-theme>", () => {
    applyThemeToDom("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyThemeToDom("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("does nothing when document is unavailable", () => {
    vi.stubGlobal("document", undefined);
    expect(() => applyThemeToDom("dark")).not.toThrow();
  });
});

describe("watchSystemTheme", () => {
  it("returns a no-op unsubscribe when matchMedia is unavailable (jsdom)", () => {
    const unsubscribe = watchSystemTheme(() => "system");
    expect(() => unsubscribe()).not.toThrow();
  });

  it('re-applies the theme on an OS scheme change while the pref is "system"', () => {
    let changeHandler: (() => void) | undefined;
    const mql = {
      matches: true,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === "change") changeHandler = handler;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));

    const unsubscribe = watchSystemTheme(() => "system");
    expect(mql.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    document.documentElement.dataset.theme = "light";
    changeHandler?.();
    expect(document.documentElement.dataset.theme).toBe("dark");

    unsubscribe();
    expect(mql.removeEventListener).toHaveBeenCalledWith("change", changeHandler);
  });

  it('does not re-apply the theme when the current pref is no longer "system"', () => {
    let changeHandler: (() => void) | undefined;
    const mql = {
      matches: true,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === "change") changeHandler = handler;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));

    watchSystemTheme(() => "light");
    document.documentElement.dataset.theme = "light";
    changeHandler?.();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
