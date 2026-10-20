import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { fetchAccountSummaries, refreshAccountSummaries, useAccountSummaries } from "./useAccountSummaries";
import { useStore } from "@/store/useStore";
import { m } from "@/i18n";

// Only a genuine empty array may clear the picker. Malformed responses or an array with no valid rows preserve the existing list; mixed responses keep valid rows and log discarded entries.

afterEach(() => {
  useStore.setState({ activeAccountId: null, masquerade: { kind: "inactive" } });
  useStore.getState().setAccountSummaries({ list: [] });
  useStore.getState().setNotice(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function createBasicResponseClassificationTests() {
  it('a genuine empty array -> [] (the real "no accounts" answer)', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, [])),
    );
    await expect(fetchAccountSummaries()).resolves.toEqual([]);
  });

  it("clears stale company choices and shows the server's ambiguous-installation error", async () => {
    useStore.getState().setAccountSummaries({
      list: [{ id: "old-company", name: "Old company", role: "owner" }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(409, { error: "This installation has more than one company." })),
    );
    await expect(fetchAccountSummaries()).resolves.toBeNull();
    expect(useStore.getState().accountSummaries).toEqual([]);
    expect(useStore.getState().accountSummariesComplete).toBe(false);
    expect(useStore.getState().accountSummariesAmbiguous).toBe(true);
    expect(useStore.getState().notice?.message).toBe(m.picker_multiple_companies_error());
  });

  it("a valid array -> validated summaries (off-spec rows dropped, not the whole list) + a warn per drop", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = [{ id: "a1", name: "Studio A", role: "editor" }, { bogus: true }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, body)),
    );
    await expect(fetchAccountSummaries()).resolves.toEqual([{ id: "a1", name: "Studio A", role: "editor" }]);
    // Partial corruption is handled-but-logged (DEFENSIVE-CODING §5): the dropped row leaves a breadcrumb.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("dropped 1 malformed"));
    expect(useStore.getState().notice).toEqual({
      message: m.picker_accounts_incomplete(),
      tone: "warning",
    });
  });

  it("rejects duplicate account identities instead of making the effective role response-order dependent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(200, [
          { id: "a1", name: "Studio A", role: "owner" },
          { id: "a1", name: "Studio A", role: "viewer" },
          { bogus: true },
        ]),
      ),
    );

    await expect(fetchAccountSummaries()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("duplicate account identities"));
    expect(useStore.getState().notice).toEqual({ message: m.picker_accounts_incomplete(), tone: "warning" });
  });
}

function createUnknownRoleResponseTest() {
  it("keeps a valid account selectable but marks an unrecognized role unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const row = { id: "a1", name: "Studio A", role: "future-role" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, [row])),
    );

    await expect(fetchAccountSummaries()).resolves.toEqual([
      { id: "a1", name: "Studio A", role: "viewer", roleStatus: "unavailable" },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unrecognized role"));
  });
}

function createMalformedResponseClassificationTests() {
  it('a NONEMPTY array whose rows are ALL malformed -> null (keep what you have, NOT a fake "no accounts") + a warn', async () => {
    // An array containing only invalid entries is a malformed response, not evidence that no companies exist. It must preserve the current picker list.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, [null])),
    );
    await expect(fetchAccountSummaries()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("dropped 1 malformed"));
    expect(useStore.getState().notice).toEqual({ message: m.picker_accounts_incomplete(), tone: "warning" });
  });

  it('an id-only row is malformed too: [{"id":"a"}] -> null, not []', async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, [{ id: "a" }])),
    );
    await expect(fetchAccountSummaries()).resolves.toBeNull();
  });

  it('a 200 whose body is NOT an array -> null (malformed, not "no accounts") + a warn breadcrumb', async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, { error: "proxy said what" })),
    );
    await expect(fetchAccountSummaries()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("non-array"));
  });

  it("a non-OK response -> null (unchanged keep-what-you-have stance)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(503, { error: "down" })),
    );
    await expect(fetchAccountSummaries()).resolves.toBeNull();
  });
}

describe("fetchAccountSummaries — response classification", () => {
  createBasicResponseClassificationTests();
  createUnknownRoleResponseTest();
  createMalformedResponseClassificationTests();
});

function createOrderedRefreshTests() {
  it("returns an active user to the picker when a live directory no longer contains that company", async () => {
    useStore.setState({ activeAccountId: "a1" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, [{ id: "a2", name: "Other", role: "viewer" }])),
    );

    await refreshAccountSummaries();

    expect(useStore.getState().activeAccountId).toBeNull();
    expect(useStore.getState().notice).toMatchObject({
      message: m.notice_company_access_removed(),
      tone: "warning",
    });
  });

  it("keeps the later-issued directory when two responses resolve in reverse order", async () => {
    const earlier = deferred<Response>();
    const later = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(() => earlier.promise)
        .mockImplementationOnce(() => later.promise),
    );

    const earlierRefresh = refreshAccountSummaries();
    const laterRefresh = refreshAccountSummaries();
    later.resolve(json(200, [{ id: "new", name: "Newest", role: "owner" }]));
    await laterRefresh;
    earlier.resolve(json(200, [{ id: "old", name: "Older", role: "owner" }]));
    await earlierRefresh;

    expect(useStore.getState().accountSummaries).toEqual([{ id: "new", name: "Newest", role: "owner" }]);
  });

  it("does not let a superseded response clear the active company or publish a removal notice", async () => {
    const earlier = deferred<Response>();
    const later = deferred<Response>();
    useStore.setState({ activeAccountId: "new" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(() => earlier.promise)
        .mockImplementationOnce(() => later.promise),
    );

    const earlierRefresh = refreshAccountSummaries();
    const laterRefresh = refreshAccountSummaries();
    later.resolve(json(200, [{ id: "new", name: "Newest", role: "owner" }]));
    await laterRefresh;
    earlier.resolve(json(200, [{ id: "old", name: "Older", role: "owner" }]));
    await earlierRefresh;

    expect(useStore.getState().activeAccountId).toBe("new");
    expect(useStore.getState().notice).toBeNull();
  });
}

function createMutationRefreshTests() {
  it("does not let an in-flight response overwrite a later direct list mutation", async () => {
    const response = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response.promise),
    );
    const refresh = refreshAccountSummaries();

    useStore.getState().setAccountSummaries({ list: [{ id: "created", name: "Just created", role: "owner" }] });
    response.resolve(json(200, [{ id: "old", name: "Before create", role: "owner" }]));
    await refresh;

    expect(useStore.getState().accountSummaries).toEqual([{ id: "created", name: "Just created", role: "owner" }]);
  });

  it("does not let a response superseded by a direct mutation clear that newly active company", async () => {
    const response = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response.promise),
    );
    const refresh = refreshAccountSummaries();

    useStore.getState().setAccountSummaries({ list: [{ id: "created", name: "Just created", role: "owner" }] });
    useStore.setState({ activeAccountId: "created" });
    response.resolve(json(200, [{ id: "old", name: "Before create", role: "owner" }]));
    await refresh;

    expect(useStore.getState().activeAccountId).toBe("created");
    expect(useStore.getState().notice).toBeNull();
  });
}

function createCompletenessRefreshTests() {
  it("publishes valid rows from an incomplete directory without treating the dropped active row as revoked", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    useStore.setState({ activeAccountId: "active" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(200, [
          { id: "active", role: "owner" },
          { id: "other", name: "Other", role: "viewer" },
        ]),
      ),
    );

    await refreshAccountSummaries();

    expect(useStore.getState().accountSummaries).toEqual([{ id: "other", name: "Other", role: "viewer" }]);
    expect(useStore.getState().accountSummariesComplete).toBe(false);
    expect(useStore.getState().activeAccountId).toBe("active");
    expect(useStore.getState().notice).toEqual({ message: m.picker_accounts_incomplete(), tone: "warning" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("dropped 1 malformed"));
  });

  it("marks a wholly valid directory as complete", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, [{ id: "only", name: "Only Co", role: "owner" }])),
    );

    await refreshAccountSummaries();

    expect(useStore.getState().accountSummariesComplete).toBe(true);
  });
}

describe("refreshAccountSummaries — shared request ordering", () => {
  createOrderedRefreshTests();
  createMutationRefreshTests();
  createCompletenessRefreshTests();
});

function HookHost() {
  useAccountSummaries();
  return null;
}

function renderWithQuery(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function createYieldingHookTest() {
  it("does not fetch the blocked company directory during an active masquerade", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    useStore.setState({
      activeAccountId: "a1",
      masquerade: {
        kind: "active",
        generation: 1,
        state: {
          accountId: "a1",
          targetUserId: "target",
          targetName: "Selina Kyle",
          effectiveRole: "viewer",
          startedAt: "2026-09-01T10:00:00.000Z",
          token: "session-token",
        },
      },
    });

    const view = renderWithQuery(<HookHost />);
    await act(async () => {});

    expect(fetchMock).not.toHaveBeenCalled();
    view.unmount();
  });

  it("yields active-account reads when the permission provider owns that generation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    useStore.setState({ activeAccountId: "a1" });

    function YieldingHost() {
      useAccountSummaries({ refreshActiveAccount: false });
      return null;
    }
    const view = renderWithQuery(<YieldingHost />);
    await act(async () => {});

    expect(fetchMock).not.toHaveBeenCalled();
    view.unmount();
  });
}

function createMalformedHookTests() {
  it("store.accountSummaries is preserved when /api/accounts 200s with a non-array body", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const existing = [{ id: "a1", name: "Studio A", role: "owner" as const }];
    useStore.getState().setAccountSummaries({ list: existing });
    let resolveFetch!: () => void;
    const done = new Promise<void>((r) => (resolveFetch = r));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // Signal after returning would race the .json() await inside the hook; queueMicrotask keeps
        // the resolution ordered behind the hook's own awaits closely enough for the flush below.
        queueMicrotask(resolveFetch);
        return json(200, { not: "an array" });
      }),
    );
    renderWithQuery(<HookHost />);
    await act(async () => {
      await done;
      // One extra macrotask so the hook's `await fetchAccountSummaries()` continuation (json parse +
      // the null early-return) has run before we assert.
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(useStore.getState().accountSummaries).toEqual(existing);
  });
}

function createMembershipHookTest() {
  it("store.accountSummaries is preserved when /api/accounts 200s with an all-malformed array ([null])", async () => {
    // An array with no valid rows is not evidence that the company directory is empty.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const existing = [{ id: "a1", name: "Studio A", role: "owner" as const }];
    useStore.getState().setAccountSummaries({ list: existing });
    let resolveFetch!: () => void;
    const done = new Promise<void>((r) => (resolveFetch = r));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        queueMicrotask(resolveFetch);
        return json(200, [null]);
      }),
    );
    renderWithQuery(<HookHost />);
    await act(async () => {
      await done;
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(useStore.getState().accountSummaries).toEqual(existing);
  });

  it("refetches account roles when membership projections are invalidated", async () => {
    let role = "owner";
    const fetchMock = vi.fn(async () => json(200, [{ id: "a1", name: "Studio A", role }]));
    vi.stubGlobal("fetch", fetchMock);
    useStore.setState({ membershipRevision: 0 });
    renderWithQuery(<HookHost />);

    await act(async () => {
      await vi.waitFor(() => expect(useStore.getState().accountSummaries[0]?.role).toBe("owner"));
    });
    role = "admin";
    act(() => useStore.getState().invalidateMemberships());

    await act(async () => {
      await vi.waitFor(() => expect(useStore.getState().accountSummaries[0]?.role).toBe("admin"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
}

describe("useAccountSummaries — a malformed 200 leaves the existing list alone", () => {
  createYieldingHookTest();
  createMalformedHookTests();
  createMembershipHookTest();
});
