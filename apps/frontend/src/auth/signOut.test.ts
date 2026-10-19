import { afterEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "@/api/queryClient";
import { AUTH_INVALIDATION_STORAGE_KEY, signOutAndReload } from "./signOut";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("signOutAndReload", () => {
  it("clears account query data before ending the session", async () => {
    queryClient.setQueryData(["private-account"], "sensitive data");

    await signOutAndReload({
      requestSignOut: async () => ({ ok: true, status: 200 }),
      reload: () => {},
    });

    expect(queryClient.getQueryData(["private-account"])).toBeUndefined();
  });

  it("clears account commands and reloads after a failed server sign-out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const clearAccountCommands = vi.fn();
    const requestSignOut = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const reload = vi.fn(() => {
      expect(localStorage.getItem(AUTH_INVALIDATION_STORAGE_KEY)).toMatch(/^[0-9a-f-]{36}$/i);
    });

    const completion = signOutAndReload({
      clearAccountCommands,
      requestSignOut,
      reload,
    });

    expect(clearAccountCommands).toHaveBeenCalledOnce();
    await completion;

    expect(requestSignOut).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    expect(localStorage.getItem(AUTH_INVALIDATION_STORAGE_KEY)).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
