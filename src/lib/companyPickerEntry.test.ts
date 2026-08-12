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
