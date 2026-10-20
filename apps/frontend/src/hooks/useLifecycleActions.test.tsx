import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLifecycleActions } from "./useLifecycleActions";
import { useStore } from "@/store/useStore";
import { makeAccount, makeAppData, resetStoreWithAccount, DEFAULT_ACCOUNT_ID } from "@/test/fixtures";
import type { FlushPendingWritesResult } from "@/data/persist";
import type { AppData } from "@capacitylens/shared/types/entities";

// Exercise lifecycle refreshes through the attached planning-cache coordinator.

// Hoist the server-mode mock before its factory runs to avoid the temporal dead zone.
const cfg = vi.hoisted(() => ({ base: "http://api.test" }));
const refreshControl = vi.hoisted(() => ({
  outcome: { kind: "reloaded" } as
    { kind: "reloaded" } | { kind: "skipped" } | { kind: "failed" } | { kind: "unattached" },
  call: vi.fn(async (accountId: string) => {
    void accountId;
    return refreshControl.outcome;
  }),
  publish: vi.fn<(accountId: string) => void>(),
}));
const lifecycleControl = vi.hoisted(() => ({
  flush: vi.fn(async (): Promise<FlushPendingWritesResult> => ({ kind: "clean" })),
  suspend: vi.fn<() => () => void>(() => vi.fn()),
  begin: vi.fn(),
  assertAllowed: vi.fn(),
  generation: 1,
}));
vi.mock("@/data/apiConfig", () => ({
  API_BASE: cfg.base,
  isServerConfigured: () => true,
}));
vi.mock("@/data/persist", () => ({
  refreshActiveAccountSlice: async (accountId: string) => {
    const outcome = await refreshControl.call(accountId);
    if (outcome.kind === "reloaded") refreshControl.publish(accountId);
    return outcome;
  },
  flushPendingWrites: () => lifecycleControl.flush(),
  suspendServerWrites: () => lifecycleControl.suspend(),
}));
vi.mock("@/data/planning/planningRuntime", () => ({
  assertPlanningWritesAllowed: () => lifecycleControl.assertAllowed(),
  getPlanningController: () => ({ begin: (originalWritable: unknown) => lifecycleControl.begin(originalWritable) }),
  hasPlanningRuntime: () => true,
}));

function reloadedSliceFor(accountId: string): AppData {
  return makeAppData({
    accounts: [makeAccount({ id: accountId })],
    clients: [
      {
        ...NULLABLE_FIELDS.clients,
        id: "c-reloaded",
        accountId,
        name: "Reloaded",
        color: "#111",
        createdAt: "t",
        updatedAt: "t",
      },
    ],
  });
}

function installPlanningContext(accountId = DEFAULT_ACCOUNT_ID): void {
  const context = { identity: Symbol(`planning-${accountId}`), companyId: accountId };
  useStore.setState((state) => ({
    planning: {
      ...state.planning,
      context,
      accessKey: "access-test",
      canWrite: true,
      revision: 1,
      status: "ready",
      pending: null,
      error: null,
    },
    masquerade: { kind: "inactive" },
  }));
  useStore.getState().setActiveRole("owner", "resolved");
}

beforeEach(() => {
  resetStoreWithAccount();
  installPlanningContext();
  refreshControl.outcome = { kind: "reloaded" };
  refreshControl.call.mockReset();
  refreshControl.call.mockImplementation(async (accountId: string) => {
    void accountId;
    return refreshControl.outcome;
  });
  refreshControl.publish.mockClear();
  refreshControl.publish.mockImplementation((accountId) => {
    useStore.setState({ data: reloadedSliceFor(accountId) });
  });
  lifecycleControl.flush.mockReset();
  lifecycleControl.flush.mockResolvedValue({ kind: "clean" });
  lifecycleControl.suspend.mockReset();
  lifecycleControl.suspend.mockImplementation(() => vi.fn());
  lifecycleControl.assertAllowed.mockReset();
  lifecycleControl.begin.mockReset();
  lifecycleControl.begin.mockImplementation((originalWritable: unknown) => {
    const planning = useStore.getState().planning;
    if (
      !planning.context ||
      !planning.canWrite ||
      planning.revision === null ||
      planning.pending ||
      !["ready", "refused"].includes(planning.status)
    ) {
      throw new Error("Planning is not ready for a lifecycle action.");
    }
    return {
      baseRevision: planning.revision,
      originalWritable,
      context: planning.context,
      generation: lifecycleControl.generation,
    };
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => response as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("useLifecycleActions — SERVER mode dispatch", () => {
  it("rejects an overlapping lifecycle mutation instead of replaying a stale action", async () => {
    const pendingRequest: { release?: () => void } = {};
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            pendingRequest.release = () =>
              resolve({ ok: true, status: 200, json: async () => ({}) } as unknown as Response);
          }),
      )
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useLifecycleActions());

    const first = result.current.archive("clients", "c-1");
    const overlapping = result.current.purge("clients", "c-1");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(pendingRequest.release).toBeDefined();
    if (pendingRequest.release === undefined) throw new Error("Expected the first lifecycle request to be pending");
    pendingRequest.release();
    await Promise.all([first, overlapping]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://api.test/api/clients/c-1/archive");
    expect(useStore.getState().notice).toMatchObject({
      tone: "info",
      message: "A lifecycle action is already in progress. Try again when it finishes.",
    });
  });
});

describe("useLifecycleActions — refresh outcomes", () => {
  it.each([
    ["archive", "archive"],
    ["unarchive", "unarchive"],
    ["softDelete", "delete"],
    ["purge", "purge"],
  ] as const)(
    "%s POSTs /api/:entity/:id/%s with {accountId} + credentials, then reloads the active slice on success",
    async (method, verb) => {
      const fetchMock = stubFetch({ ok: true, status: 200, json: async () => ({}) });
      const { result } = renderHook(() => useLifecycleActions());

      await result.current[method]("clients", "c-1");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const firstCall: unknown = fetchMock.mock.calls[0];
      if (!Array.isArray(firstCall) || typeof firstCall[0] !== "string" || typeof firstCall[1] !== "object") {
        throw new Error("Expected fetch to receive a URL and request options");
      }
      const [url, init] = firstCall as [string, RequestInit];
      expect(url).toBe(`http://api.test/api/clients/c-1/${verb}`);
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("include");
      expect(JSON.parse(init.body as string)).toEqual({ accountId: DEFAULT_ACCOUNT_ID });

      expect(refreshControl.call).toHaveBeenCalledWith(DEFAULT_ACCOUNT_ID);
      expect(useStore.getState().data.clients.some((c) => c.id === "c-reloaded")).toBe(true);

      if (method === "softDelete" || method === "purge") {
        expect(lifecycleControl.flush).toHaveBeenCalledOnce();
        expect(lifecycleControl.suspend).toHaveBeenCalledOnce();
      }

      expect(useStore.getState().notice).toBeNull();
    },
  );
});

describe("useLifecycleActions — orchestrated refresh", () => {
  it("delegates a successful lifecycle reload to the attached persistence orchestrator", async () => {
    refreshControl.outcome = { kind: "reloaded" };
    const onReloaded = vi.fn();
    stubFetch({ ok: true, status: 200, json: async () => ({}) });
    const { result } = renderHook(() => useLifecycleActions(onReloaded));

    await result.current.archive("clients", "c-1");

    expect(refreshControl.call).toHaveBeenCalledOnce();
    expect(refreshControl.call).toHaveBeenCalledWith(DEFAULT_ACCOUNT_ID);
    expect(onReloaded).toHaveBeenCalledOnce();
  });

  it.each([
    {
      outcome: "skipped" as const,
      expectedGuidance: "other changes are still failing to save",
    },
    {
      outcome: "failed" as const,
      expectedGuidance: "the latest company data could not be loaded",
    },
  ])(
    "a confirmed mutation with a $outcome mandatory refresh surfaces committed-but-stale guidance and gates retries",
    async ({ outcome, expectedGuidance }) => {
      const accountId = `acct-confirmed-${outcome}`;
      resetStoreWithAccount(accountId);
      installPlanningContext(accountId);
      refreshControl.outcome = { kind: outcome };
      const onReloaded = vi.fn();
      const fetchMock = stubFetch({ ok: true, status: 200, json: async () => ({}) });
      const firstSurface = renderHook(() => useLifecycleActions(onReloaded));

      await firstSurface.result.current.archive("clients", "c-1");

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(refreshControl.call).toHaveBeenCalledOnce();
      expect(refreshControl.call).toHaveBeenCalledWith(accountId);
      expect(onReloaded).not.toHaveBeenCalled();
      const notice = useStore.getState().notice;
      expect(notice?.tone).toBe("error");
      expect(notice?.message).toContain("saved on the server");
      expect(notice?.message).toContain(expectedGuidance);
      expect(notice?.message).toContain("Reload this page before archiving, restoring, or deleting another item");

      // The first POST is confirmed but the shared store still shows its pre-mutation slice. Even a
      // different route/component instance must not POST again until a full reload rehydrates it.
      firstSurface.unmount();
      const secondSurface = renderHook(() => useLifecycleActions());
      await secondSurface.result.current.purge("clients", "c-1");

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(refreshControl.call).toHaveBeenCalledOnce();
      expect(useStore.getState().notice?.message).toContain(expectedGuidance);
    },
  );

  it.each(["softDelete", "purge"] as const)(
    "%s flushes, suspends, dispatches, refreshes, clears history, and resumes in order",
    async (method) => {
      const order: string[] = [];
      lifecycleControl.flush.mockImplementation(async () => {
        order.push("flush");
        return { kind: "clean" };
      });
      lifecycleControl.suspend.mockImplementation(() => {
        order.push("suspend");
        return () => order.push("resume");
      });
      refreshControl.call.mockImplementation(async () => {
        order.push("refresh");
        return { kind: "reloaded" };
      });
      const fetchMock = vi.fn(async () => {
        order.push("request");
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      });
      vi.stubGlobal("fetch", fetchMock);
      const clearHistory = vi.spyOn(useStore.getState(), "clearUndoHistory").mockImplementation(() => {
        order.push("clear-history");
      });
      clearHistory.mockClear();
      const { result } = renderHook(() => useLifecycleActions());

      await result.current[method]("clients", "c-1");

      expect(order).toEqual(["flush", "suspend", "request", "refresh", "clear-history", "resume"]);
      expect(clearHistory).toHaveBeenCalledOnce();
    },
  );

  it("does not hand off when pending planning work cannot be flushed", async () => {
    lifecycleControl.flush.mockResolvedValue({ kind: "blocked" });
    const fetchMock = stubFetch({ ok: true, status: 200, json: async () => ({}) });
    const clearHistory = vi.spyOn(useStore.getState(), "clearUndoHistory");
    clearHistory.mockClear();
    const { result } = renderHook(() => useLifecycleActions());

    await result.current.softDelete("clients", "c-1");

    expect(lifecycleControl.flush).toHaveBeenCalledOnce();
    expect(lifecycleControl.assertAllowed).toHaveBeenCalledOnce();
    expect(lifecycleControl.suspend).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(clearHistory).not.toHaveBeenCalled();
    expect(useStore.getState().notice?.tone).toBe("error");
    expect(useStore.getState().notice?.message).toContain("Pending company changes must finish saving");
  });

  it("rejects a delete while a planning mutation is already pending so it cannot capture stale intent", async () => {
    useStore.setState((state) => ({
      planning: {
        ...state.planning,
        pending: { kind: "new" } as NonNullable<typeof state.planning.pending>,
        status: "pending",
      },
    }));
    const fetchMock = stubFetch({ ok: true, status: 200, json: async () => ({}) });
    const { result } = renderHook(() => useLifecycleActions());

    await result.current.softDelete("clients", "c-1");

    expect(lifecycleControl.flush).not.toHaveBeenCalled();
    expect(lifecycleControl.suspend).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useStore.getState().notice?.message).toContain("A company change is still in progress");
  });

  it("rechecks captured context after flushing and suppresses work after access changes", async () => {
    lifecycleControl.flush.mockImplementation(async () => {
      useStore.setState((state) => ({
        planning: { ...state.planning, context: { identity: Symbol("new-access"), companyId: DEFAULT_ACCOUNT_ID } },
      }));
      return { kind: "clean" };
    });
    const fetchMock = stubFetch({ ok: true, status: 200, json: async () => ({}) });
    const { result } = renderHook(() => useLifecycleActions());

    await result.current.purge("clients", "c-1");

    expect(lifecycleControl.flush).toHaveBeenCalledOnce();
    expect(lifecycleControl.suspend).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not clear history or notify after access changes while the delete request is in flight", async () => {
    const onReloaded = vi.fn();
    const clearHistory = vi.spyOn(useStore.getState(), "clearUndoHistory");
    const fetchMock = vi.fn(async () => {
      useStore.setState((state) => ({
        planning: {
          ...state.planning,
          context: { identity: Symbol("replacement-access"), companyId: DEFAULT_ACCOUNT_ID },
        },
      }));
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useLifecycleActions(onReloaded));

    await result.current.softDelete("clients", "c-1");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(refreshControl.call).not.toHaveBeenCalled();
    expect(clearHistory).not.toHaveBeenCalled();
    expect(onReloaded).not.toHaveBeenCalled();
    expect(useStore.getState().notice).toBeNull();
  });

  it.each(["viewer", "masquerade", "read-only"] as const)(
    "refuses %s authority before flushing or dispatching a delete",
    async (mode) => {
      if (mode === "viewer") useStore.getState().setActiveRole("viewer", "resolved");
      if (mode === "masquerade")
        useStore.getState().setMasquerade({
          kind: "starting",
          pending: { accountId: DEFAULT_ACCOUNT_ID, targetUserId: "user-target" },
          generation: 1,
        });
      if (mode === "read-only") useStore.setState((state) => ({ planning: { ...state.planning, canWrite: false } }));
      const fetchMock = stubFetch({ ok: true, status: 200, json: async () => ({}) });
      const { result } = renderHook(() => useLifecycleActions());

      await result.current.softDelete("clients", "c-1");

      expect(lifecycleControl.flush).not.toHaveBeenCalled();
      expect(lifecycleControl.suspend).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(useStore.getState().notice?.tone).toBe("error");
    },
  );

  it("releases suspension and gates retries when a confirmed delete cannot refresh canonical data", async () => {
    const accountId = "acct-confirmed-delete-refresh-failed";
    resetStoreWithAccount(accountId);
    installPlanningContext(accountId);
    refreshControl.outcome = { kind: "failed" };
    const onReloaded = vi.fn();
    const fetchMock = stubFetch({ ok: true, status: 200, json: async () => ({}) });
    const resume = vi.fn();
    const clearHistory = vi.spyOn(useStore.getState(), "clearUndoHistory");
    clearHistory.mockClear();
    lifecycleControl.suspend.mockReturnValue(resume);
    const { result, unmount } = renderHook(() => useLifecycleActions(onReloaded));

    await result.current.softDelete("clients", "c-1");

    expect(useStore.getState().notice?.message).not.toBe(
      "Lifecycle actions are unavailable for the current company or access level.",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    expect(clearHistory).not.toHaveBeenCalled();
    expect(onReloaded).not.toHaveBeenCalled();
    expect(useStore.getState().notice?.message).toContain("saved on the server");
    expect(useStore.getState().notice?.message).toContain("could not be loaded");
    unmount();
    const second = renderHook(() => useLifecycleActions());
    await second.result.current.purge("clients", "c-1");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(lifecycleControl.flush).toHaveBeenCalledOnce();
  });
});

describe("useLifecycleActions — refresh callback", () => {
  it("does not reconcile or misreport a callback failure after a confirmed mutation and reload", async () => {
    refreshControl.outcome = { kind: "reloaded" };
    const onReloaded = vi.fn(() => {
      throw new Error("inactive-list refresh failed");
    });
    stubFetch({ ok: true, status: 200, json: async () => ({}) });
    const { result } = renderHook(() => useLifecycleActions(onReloaded));

    await expect(result.current.archive("clients", "c-1")).resolves.toBeUndefined();

    expect(refreshControl.call).toHaveBeenCalledOnce();
    expect(onReloaded).toHaveBeenCalledOnce();
    expect(useStore.getState().notice).toMatchObject({
      tone: "error",
      message: "inactive-list refresh failed",
    });
    expect(useStore.getState().notice?.message).not.toContain("unknown outcome");
  });

  it("a 409 (purge <30d) surfaces body.error via an error notice and does NOT throw or reload", async () => {
    const fetchMock = stubFetch({
      ok: false,
      status: 409,
      json: async () => ({ error: "Can only be permanently deleted 30 days after deletion." }),
    });
    const { result } = renderHook(() => useLifecycleActions());

    await expect(result.current.purge("clients", "c-young")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useStore.getState().notice?.tone).toBe("error");
    expect(useStore.getState().notice?.message).toBe("Can only be permanently deleted 30 days after deletion.");

    expect(useStore.getState().data.clients.some((c) => c.id === "c-reloaded")).toBe(false);
  });
});

describe("useLifecycleActions — server failures", () => {
  it("a 403 (non-admin purge) surfaces body.error via an error notice and resolves", async () => {
    stubFetch({ ok: false, status: 403, json: async () => ({ error: "You do not have permission to do that." }) });
    const { result } = renderHook(() => useLifecycleActions());

    await expect(result.current.purge("resources", "r-1")).resolves.toBeUndefined();

    expect(useStore.getState().notice?.tone).toBe("error");
    expect(useStore.getState().notice?.message).toBe("You do not have permission to do that.");
    expect(refreshControl.call).not.toHaveBeenCalled();
  });

  it.each([408, 504])(
    "reconciles an HTTP %s response as an unknown lifecycle outcome before allowing a retry",
    async (status) => {
      stubFetch({
        ok: false,
        status,
        json: async () => ({ error: "Gateway did not confirm the mutation." }),
      });
      const onReloaded = vi.fn();
      const { result } = renderHook(() => useLifecycleActions(onReloaded));

      await result.current.softDelete("resources", "r-1");

      expect(refreshControl.call).toHaveBeenCalledWith(DEFAULT_ACCOUNT_ID);
      expect(onReloaded).toHaveBeenCalledOnce();
      expect(useStore.getState().data.clients.some((client) => client.id === "c-reloaded")).toBe(true);
      expect(useStore.getState().notice?.tone).toBe("warning");
      expect(useStore.getState().notice?.message).toContain("unknown outcome");
      expect(useStore.getState().notice?.message).toContain(`HTTP ${status}`);
    },
  );
});

describe("useLifecycleActions — successful response variants", () => {
  it("a 204 purge (no body) is treated as success: reloads without a body-parse error", async () => {
    // A 204 response has no body, so successful lifecycle completion must not parse JSON.
    const fetchMock = stubFetch({
      ok: false,
      status: 204,
      json: async () => {
        throw new Error("no content to parse");
      },
    });
    const { result } = renderHook(() => useLifecycleActions());

    await result.current.purge("clients", "c-old");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://api.test/api/clients/c-old/purge");
    expect(refreshControl.call).toHaveBeenCalledWith(DEFAULT_ACCOUNT_ID);
    expect(useStore.getState().data.clients.some((c) => c.id === "c-reloaded")).toBe(true);
    expect(useStore.getState().notice).toBeNull();
  });
});

describe("useLifecycleActions — account switching", () => {
  it("SKIPS the post-mutation reload when the active account changed while the POST was in flight", async () => {
    // A mutation completed in another tenant must not refresh its slice over the current
    // tenant; the switch orchestrator owns the new tenant hydration.
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        useStore.getState().setActiveAccount(null);
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useLifecycleActions());

    await result.current.archive("clients", "c-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshControl.call).not.toHaveBeenCalled();

    expect(useStore.getState().data.clients.some((c) => c.id === "c-reloaded")).toBe(false);
    expect(useStore.getState().notice).toBeNull();

    // Tenant staleness is not a degraded same-company refresh and must not arm the reload gate.
    // Returning to the original company performs its normal hydrate, so another action can dispatch.
    act(() => useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID));
    await result.current.unarchive("clients", "c-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshControl.call).toHaveBeenCalledWith(DEFAULT_ACCOUNT_ID);
    expect(useStore.getState().notice).toBeNull();
  });
});

describe("useLifecycleActions — detached coordinator safety", () => {
  it("requires a full reload when detached after a confirmed mutation and never publishes a bare slice", async () => {
    const accountId = "acct-detached-refresh";
    resetStoreWithAccount(accountId);
    installPlanningContext(accountId);
    refreshControl.outcome = { kind: "unattached" };
    const onReloaded = vi.fn();
    stubFetch({ ok: true, status: 200, json: async () => ({}) });
    const first = renderHook(() => useLifecycleActions(onReloaded));

    await first.result.current.archive("clients", "c-1");

    expect(refreshControl.call).toHaveBeenCalledOnce();
    expect(refreshControl.call).toHaveBeenCalledWith(accountId);
    expect(refreshControl.publish).not.toHaveBeenCalled();
    expect(onReloaded).not.toHaveBeenCalled();
    expect(useStore.getState().data.clients.some((client) => client.id === "c-reloaded")).toBe(false);
    expect(useStore.getState().notice?.tone).toBe("error");
    expect(useStore.getState().notice?.message).toContain("saved on the server");
    expect(useStore.getState().notice?.message).toContain(
      "Reload this page before archiving, restoring, or deleting another item",
    );

    const second = renderHook(() => useLifecycleActions());
    await second.result.current.purge("clients", "c-1");
    expect(refreshControl.call).toHaveBeenCalledOnce();
    expect(useStore.getState().notice?.message).toContain(
      "Reload this page before archiving, restoring, or deleting another item",
    );
  });

  it.each(["skipped", "failed"] as const)(
    "does not report transport-failure reconciliation as successful when refresh returns %s",
    async (outcome) => {
      const account = makeAccount({ id: `acct-${outcome}`, name: `${outcome} Co` });
      const current = useStore.getState().data;
      useStore.getState().replaceAll({ ...current, accounts: [...current.accounts, account] });
      useStore.getState().setActiveAccount(account.id);
      refreshControl.outcome = { kind: outcome };
      const onReloaded = vi.fn();
      const fetchMock = vi.fn(async () => {
        throw new TypeError("connection lost");
      });
      vi.stubGlobal("fetch", fetchMock);
      const first = renderHook(() => useLifecycleActions(onReloaded));

      await first.result.current.archive("clients", "c-1");

      expect(onReloaded).not.toHaveBeenCalled();
      expect(useStore.getState().notice?.tone).toBe("error");
      expect(useStore.getState().notice?.message).toContain("could not be reconciled");
      expect(useStore.getState().notice?.message).toContain(`(${outcome})`);
      expect(useStore.getState().notice?.message).toContain("connection lost");

      first.unmount();
      const second = renderHook(() => useLifecycleActions(onReloaded));
      await second.result.current.purge("clients", "c-1");
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(useStore.getState().notice?.message).toContain("Reload before retrying");
    },
  );
});

describe("useLifecycleActions — stale transport failures", () => {
  it("suppresses a transport reconciliation notice after the user leaves the company", async () => {
    const onReloaded = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        useStore.getState().setActiveAccount(null);
        throw new TypeError("connection lost");
      }),
    );
    const { result } = renderHook(() => useLifecycleActions(onReloaded));

    await result.current.archive("clients", "c-1");

    expect(onReloaded).not.toHaveBeenCalled();
    expect(refreshControl.call).not.toHaveBeenCalled();
    expect(useStore.getState().notice).toBeNull();
  });
});
