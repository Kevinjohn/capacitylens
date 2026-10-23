import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { apiRouteUrl, clearQueryCacheForScopeChange, client, scopeQueryKey } from "./queryClient";

describe("same-origin API requests", () => {
  it("keeps API requests rooted when the browser is on a nested account route", async () => {
    let requestedUrl: string | undefined;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = input instanceof Request ? input.url : input.toString();
      return Response.json({ user: { id: "bruce" } });
    });
    vi.stubGlobal("fetch", fetch);
    window.history.replaceState(null, "", "/account/");

    try {
      await client.request("api.auth.me", {});
      if (requestedUrl === undefined) throw new Error("API request did not reach fetch.");
      expect(new URL(requestedUrl).pathname).toBe("/api/auth/me");
      expect(apiRouteUrl("api.auth.me", {})).toBe("/api/auth/me");
    } finally {
      vi.unstubAllGlobals();
      window.history.replaceState(null, "", "/");
    }
  });
});

describe("account query cache scope", () => {
  it("partitions route keys by principal, company, and masquerade generation", () => {
    expect(
      scopeQueryKey({ principalId: "bruce", accountId: "wayne", masqueradeGeneration: 2 }, [
        "api.members.index",
        { params: { accountId: "wayne" } },
      ] as const),
    ).toEqual(["capacitylens", "bruce", "wayne", 2, "api.members.index", { params: { accountId: "wayne" } }]);
  });

  it.each([
    [
      "principal",
      { principalId: "bruce", accountId: "wayne", masqueradeGeneration: 0 },
      { principalId: "alfred", accountId: "wayne", masqueradeGeneration: 0 },
    ],
    [
      "company",
      { principalId: "bruce", accountId: "wayne", masqueradeGeneration: 0 },
      { principalId: "bruce", accountId: "stark", masqueradeGeneration: 0 },
    ],
    [
      "masquerade generation",
      { principalId: "bruce", accountId: "wayne", masqueradeGeneration: 1 },
      { principalId: "bruce", accountId: "wayne", masqueradeGeneration: 2 },
    ],
  ])("clears data when the %s changes", (_label, previous, next) => {
    const client = new QueryClient();
    client.setQueryData(["private"], { name: "Wayne Enterprises" });

    expect(clearQueryCacheForScopeChange(client, previous, next)).toBe(true);
    expect(client.getQueryData(["private"])).toBeUndefined();
  });

  it("keeps cached data when the entire identity scope is unchanged", () => {
    const client = new QueryClient();
    const scope = { principalId: "bruce", accountId: "wayne", masqueradeGeneration: 1 } as const;
    client.setQueryData(["private"], { name: "Wayne Enterprises" });

    expect(clearQueryCacheForScopeChange(client, scope, scope)).toBe(false);
    expect(client.getQueryData(["private"])).toEqual({ name: "Wayne Enterprises" });
  });
});

describe("QueryCacheLifecycle", () => {
  it("clears private results across principal, company, and masquerade transitions", async () => {
    const { act, render } = await import("@testing-library/react");
    const { AuthContext } = await import("@/auth/authContext");
    const { useStore } = await import("@/store/useStore");
    const { QueryCacheLifecycle } = await import("./QueryCacheLifecycle");
    const cache = new QueryClient();
    const authValue = (id: string | null) => ({
      authMode: "password-only" as const,
      user: id ? { id } : null,
      providers: [],
      canCreateAccount: true,
      refreshAuth: async () => {},
      signOut: async () => {},
    });
    useStore.setState({ activeAccountId: null, masquerade: { kind: "inactive" } });
    const tree = (principalId: string | null) => (
      <AuthContext.Provider value={authValue(principalId)}>
        <QueryCacheLifecycle cache={cache} />
      </AuthContext.Provider>
    );
    const { rerender, unmount } = render(tree("bruce"));
    const seed = () => cache.setQueryData(["private"], "sensitive data");
    const expectCleared = () => expect(cache.getQueryData(["private"])).toBeUndefined();

    seed();
    rerender(tree("alfred"));
    expectCleared();

    seed();
    await act(async () => useStore.setState({ activeAccountId: "wayne" }));
    expectCleared();

    seed();
    await act(async () =>
      useStore.setState({
        masquerade: { kind: "starting", pending: { accountId: "wayne", targetUserId: "target" }, generation: 1 },
      }),
    );
    expectCleared();

    unmount();
    const remounted = render(tree("alfred"));
    seed();
    remounted.unmount();
    render(tree("bruce"));
    expectCleared();
    useStore.setState({ activeAccountId: null, masquerade: { kind: "inactive" } });
  });
});
