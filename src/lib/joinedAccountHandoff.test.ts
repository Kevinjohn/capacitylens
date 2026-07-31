import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearJoinedAccountHandoff,
  joinedAccountEntryPath,
  readJoinedAccountHandoff,
  reloadCurrentPage,
  replaceWithAccountPicker,
  replaceWithJoinedAccount,
} from "./joinedAccountHandoff";

const realLocation = window.location;

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: realLocation,
  });
});

describe("joined account handoff", () => {
  it("round-trips an opaque account id through the one-use entry query", () => {
    const path = joinedAccountEntryPath("account / one");
    expect(path).toBe("/?joinedAccount=account%20%2F%20one");
    expect(readJoinedAccountHandoff(path.slice(path.indexOf("?")))).toBe("account / one");
  });

  it("ignores missing and empty destinations", () => {
    expect(readJoinedAccountHandoff("")).toBeNull();
    expect(readJoinedAccountHandoff("?joinedAccount=")).toBeNull();
    expect(readJoinedAccountHandoff("?other=1")).toBeNull();
  });

  it("returns the destination unchanged when present and non-empty", () => {
    expect(readJoinedAccountHandoff("?joinedAccount=account-1")).toBe("account-1");
    expect(readJoinedAccountHandoff("?joinedAccount=account-1&other=1")).toBe("account-1");
  });

  it("removes only the one-use destination from a combined query", () => {
    expect(clearJoinedAccountHandoff("?tab=security&joinedAccount=account-1&view=archived")).toBe(
      "?tab=security&view=archived",
    );
    expect(clearJoinedAccountHandoff("?joinedAccount=account-1")).toBe("");
  });
});

describe("navigation boundaries", () => {
  it("replaces the current page with the requested account's entry path", () => {
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, replace },
    });

    replaceWithJoinedAccount("account-1");

    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/?joinedAccount=account-1");
  });

  it("replaces the current page with the root account picker", () => {
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, replace },
    });

    replaceWithAccountPicker();

    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("reloads the current page in place", () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, reload },
    });

    reloadCurrentPage();

    expect(reload).toHaveBeenCalledOnce();
  });
});
