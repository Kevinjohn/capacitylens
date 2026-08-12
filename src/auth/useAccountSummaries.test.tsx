import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { fetchAccountSummaries, refreshAccountSummaries, useAccountSummaries } from "./useAccountSummaries";
import { useStore } from "../store/useStore";
import {
  cacheAccountSummaries,
  offlineStateSnapshot,
  readCachedAccountSummaries,
  setOfflineReadState,
} from "../data/offlineCache";
import { m } from "@/i18n";

vi.mock("../data/offlineCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/offlineCache")>();
  return {
    ...actual,
    cacheAccountSummaries: vi.fn(actual.cacheAccountSummaries),
    readCachedAccountSummaries: vi.fn(actual.readCachedAccountSummaries),
  };
});

// P1.13 — the AccountPicker's data source. These tests pin the fetch contract's three distinct
// answers, in particular the malformed-200 case (the bug this pins: a 200 whose JSON body is not
// an array used to coerce to `[]` — a fake "no accounts" that blanked the picker — where every
// other failure reported null / keep-what-you-have):
//   - a real array        -> the validated list ([] only for a GENUINE empty array; off-spec rows
//                            are dropped with a console.warn breadcrumb — partial corruption is
//                            handled-but-logged, never silent)
//   - a non-OK response   -> null (keep what you have)
//   - a 200 NON-ARRAY body -> null too, same stance, with a console.warn breadcrumb
//   - a NONEMPTY array where EVERY row is off-spec -> null too (malformed, NOT "no accounts" —
//                            an [] here would blank the picker over a broken response)
// plus the hook-level consequence: a null read leaves store.accountSummaries untouched.

afterEach(() => {
  useStore.setState({ activeAccountId: null });
  useStore.getState().setAccountSummaries([]);
  useStore.getState().setNotice(null);
  setOfflineReadState("cleanup", false);
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

describe("fetchAccountSummaries — response classification", () => {
  it('a genuine empty array -> [] (the real "no accounts" answer)', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, [])),
    );
    await expect(fetchAccountSummaries()).resolves.toEqual([]);
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
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("dropped 1 malformed"), body);
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
        ]),
      ),
    );

    await expect(fetchAccountSummaries()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("duplicate account identities"));
  });

  it("does not mark a cached active slice online merely because the company directory responds", async () => {
    useStore.setState({ activeAccountId: "a1" });
    setOfflineReadState("accounts", true, Date.parse("2026-07-17T10:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, [{ id: "a1", name: "Studio A", role: "owner" }])),
    );

    await expect(fetchAccountSummaries()).resolves.toHaveLength(1);

    expect(offlineStateSnapshot().readOnly).toBe(true);
  });

  it("does clear an identity/list-only offline marker at the company picker", async () => {
    useStore.setState({ activeAccountId: null });
    setOfflineReadState("accounts", true, Date.parse("2026-07-17T10:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, [{ id: "a1", name: "Studio A", role: "owner" }])),
    );

    await expect(fetchAccountSummaries()).resolves.toHaveLength(1);

    expect(offlineStateSnapshot().readOnly).toBe(false);
  });

  it("does not mark a live active slice read-only when only the company directory falls back to cache", async () => {
    const savedAt = Date.parse("2026-07-17T10:00:00.000Z");
    useStore.setState({ activeAccountId: "a1" });
    vi.mocked(readCachedAccountSummaries).mockResolvedValueOnce({
      key: "cached-accounts",
      savedAt,
      value: [{ id: "a1", name: "Studio A", role: "owner" }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(503, { error: "down" })),
    );

    await expect(fetchAccountSummaries()).resolves.toEqual([{ id: "a1", name: "Studio A", role: "owner" }]);

    expect(offlineStateSnapshot()).toEqual({
      readOnly: false,
      lastUpdated: null,
      cacheWriteFailed: false,
    });
  });

  it("does mark the picker read-only when its company directory falls back to cache", async () => {
    const savedAt = Date.parse("2026-07-17T10:00:00.000Z");
    useStore.setState({ activeAccountId: null });
    vi.mocked(readCachedAccountSummaries).mockResolvedValueOnce({
      key: "cached-accounts",
      savedAt,
      value: [{ id: "a1", name: "Studio A", role: "owner" }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(503, { error: "down" })),
    );

    await expect(fetchAccountSummaries()).resolves.toHaveLength(1);

    expect(offlineStateSnapshot()).toEqual({
      readOnly: true,
      lastUpdated: savedAt,
      cacheWriteFailed: false,
    });
  });

  it("keeps a valid account selectable but marks an unrecognized role unavailable", async () => {
    vi.mocked(cacheAccountSummaries).mockClear();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const row = { id: "a1", name: "Studio A", role: "future-role" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, [row])),
    );

    await expect(fetchAccountSummaries()).resolves.toEqual([
      { id: "a1", name: "Studio A", role: "viewer", roleStatus: "unavailable" },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unrecognized role"), row);
    expect(cacheAccountSummaries).not.toHaveBeenCalled();
  });

  it('a NONEMPTY array whose rows are ALL malformed -> null (keep what you have, NOT a fake "no accounts") + a warn', async () => {
    // The regression this pins: [null] used to map/filter to [], which the hook treated as a genuine
    // empty list and blanked the picker — contradicting the "[] is reserved for a genuine empty
    // array" contract. All-rows-invalid is a MALFORMED response, so it reports null like the
    // non-array case (the hook then leaves the existing list untouched).
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, [null])),
    );
    await expect(fetchAccountSummaries()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("dropped 1 malformed"), [null]);
  });

  it('an id-only row is malformed too: [{"id":"a"}] -> null, not []', async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {}); // silence the expected breadcrumb
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
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("non-array"), {
      error: "proxy said what",
    });
  });

  it("a non-OK response -> null (unchanged keep-what-you-have stance)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(503, { error: "down" })),
    );
    await expect(fetchAccountSummaries()).resolves.toBeNull();
  });

  it("refuses a cached directory when a caller requires authoritative reconciliation", async () => {
    vi.mocked(readCachedAccountSummaries).mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(503, { error: "down" })),
    );

    await expect(fetchAccountSummaries({ allowCachedFallback: false })).resolves.toBeNull();
    expect(readCachedAccountSummaries).not.toHaveBeenCalled();
  });

  it("a 5xx plus an unreadable offline directory still resolves null instead of rejecting", async () => {
    const cacheError = new Error("IndexedDB unavailable");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(readCachedAccountSummaries).mockRejectedValueOnce(cacheError);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(503, { error: "down" })),
    );

    await expect(fetchAccountSummaries()).resolves.toBeNull();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("offline account list could not be read"), cacheError);
  });
});

describe("refreshAccountSummaries — shared request ordering", () => {
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

  it("does not let an in-flight response overwrite a later direct list mutation", async () => {
    const response = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response.promise),
    );
    const refresh = refreshAccountSummaries();

    useStore.getState().setAccountSummaries([{ id: "created", name: "Just created", role: "owner" }]);
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

    useStore.getState().setAccountSummaries([{ id: "created", name: "Just created", role: "owner" }]);
    useStore.setState({ activeAccountId: "created" });
    response.resolve(json(200, [{ id: "old", name: "Before create", role: "owner" }]));
    await refresh;

    expect(useStore.getState().activeAccountId).toBe("created");
    expect(useStore.getState().notice).toBeNull();
  });

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
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("dropped 1 malformed"), expect.any(Array));
  });

  it("marks a wholly valid directory as complete", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, [{ id: "only", name: "Only Co", role: "owner" }])),
    );

    await refreshAccountSummaries();

    expect(useStore.getState().accountSummariesComplete).toBe(true);
  });
});

/** Mounts the hook bare — it renders nothing; the observable effect is on the store. */
function HookHost() {
  useAccountSummaries();
  return null;
}

describe("useAccountSummaries — a malformed 200 leaves the existing list alone", () => {
  it("yields active-account reads when the permission provider owns that generation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    useStore.setState({ activeAccountId: "a1" });

    function YieldingHost() {
      useAccountSummaries({ refreshActiveAccount: false });
      return null;
    }
    const view = render(<YieldingHost />);
    await act(async () => {});

    expect(fetchMock).not.toHaveBeenCalled();
    view.unmount();
  });

  it("store.accountSummaries is preserved when /api/accounts 200s with a non-array body", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {}); // silence the expected breadcrumb
    const existing = [{ id: "a1", name: "Studio A", role: "owner" as const }];
    useStore.getState().setAccountSummaries(existing);
    let resolveFetch!: () => void;
    const done = new Promise<void>((r) => (resolveFetch = r));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // Signal AFTER returning would race the .json() await inside the hook; queueMicrotask keeps
        // the resolution ordered behind the hook's own awaits closely enough for the flush below.
        queueMicrotask(resolveFetch);
        return json(200, { not: "an array" });
      }),
    );
    render(<HookHost />);
    await act(async () => {
      await done;
      // One extra macrotask so the hook's `await fetchAccountSummaries()` continuation (json parse +
      // the null early-return) has run before we assert.
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(useStore.getState().accountSummaries).toEqual(existing); // untouched — not blanked to []
  });

  it("store.accountSummaries is preserved when /api/accounts 200s with an all-malformed array ([null])", async () => {
    // Same stance as the non-array case above, via the all-rows-dropped -> null path: an array of
    // junk must not read as "no accounts" and blank the picker.
    vi.spyOn(console, "warn").mockImplementation(() => {}); // silence the expected breadcrumb
    const existing = [{ id: "a1", name: "Studio A", role: "owner" as const }];
    useStore.getState().setAccountSummaries(existing);
    let resolveFetch!: () => void;
    const done = new Promise<void>((r) => (resolveFetch = r));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        queueMicrotask(resolveFetch); // same ordering trick as the non-array case above
        return json(200, [null]);
      }),
    );
    render(<HookHost />);
    await act(async () => {
      await done;
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(useStore.getState().accountSummaries).toEqual(existing); // untouched — not blanked to []
  });

  it("refetches account roles when membership projections are invalidated", async () => {
    let role = "owner";
    const fetchMock = vi.fn(async () => json(200, [{ id: "a1", name: "Studio A", role }]));
    vi.stubGlobal("fetch", fetchMock);
    useStore.setState({ membershipRevision: 0 });
    render(<HookHost />);

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
});
