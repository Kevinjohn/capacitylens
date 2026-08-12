import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeCompanyPickerForReload, markCompanyPickerForNextReload } from "./companyPickerEntry";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("post-sign-in company-picker entry", () => {
  it("preserves router state and consumes its marker exactly once", () => {
    window.history.replaceState({ idx: 4, usr: { from: "login" } }, "", "/clients?view=archived");

    markCompanyPickerForNextReload();

    expect(consumeCompanyPickerForReload()).toBe(true);
    expect(consumeCompanyPickerForReload()).toBe(false);
    expect(window.history.state).toEqual({ idx: 4, usr: { from: "login" } });
    expect(window.location.href).toBe("http://localhost:3000/clients?view=archived");
  });

  it("writes only the stable marker while preserving the exact route and router state", () => {
    const url = "/projects?client=wayne#active";
    window.history.replaceState({ idx: 9, key: "router-key", usr: null }, "", url);

    markCompanyPickerForNextReload();

    expect(window.history.state).toEqual({
      idx: 9,
      key: "router-key",
      usr: null,
      "capacitylens.showCompanyPickerOnReload": true,
    });
    expect(window.location.href).toBe("http://localhost:3000/projects?client=wayne#active");

    expect(consumeCompanyPickerForReload()).toBe(true);
    expect(window.history.state).toEqual({ idx: 9, key: "router-key", usr: null });
    expect(window.location.href).toBe("http://localhost:3000/projects?client=wayne#active");
  });

  it.each([
    ["null", null],
    ["array", ["router-state"]],
    ["string", "router-state"],
    ["number", 4],
    ["boolean", false],
  ])("repairs %s history state without spreading malformed values", (_label, state) => {
    window.history.replaceState(state, "", "/settings?section=account");

    markCompanyPickerForNextReload();

    expect(window.history.state).toEqual({ "capacitylens.showCompanyPickerOnReload": true });
    expect(consumeCompanyPickerForReload()).toBe(true);
    expect(window.history.state).toEqual({});
    expect(window.location.href).toBe("http://localhost:3000/settings?section=account");
  });

  it("does not consume marker-like values that are not exactly true", () => {
    for (const marker of [false, "true", 1, null, { enabled: true }]) {
      const state = { idx: 3, "capacitylens.showCompanyPickerOnReload": marker };
      window.history.replaceState(state, "", "/clients");

      expect(consumeCompanyPickerForReload()).toBe(false);
      expect(window.history.state).toEqual(state);
    }
  });

  it("fails safely when clearing the one-use marker is unavailable", () => {
    markCompanyPickerForNextReload();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {
      throw new DOMException("History unavailable");
    });

    expect(consumeCompanyPickerForReload()).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("could not be cleared"), expect.any(DOMException));
  });

  it("does not block a successful sign-in when marking history state is unavailable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {
      throw new DOMException("History unavailable");
    });

    expect(() => markCompanyPickerForNextReload()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("could not be set"), expect.any(DOMException));
  });
});
